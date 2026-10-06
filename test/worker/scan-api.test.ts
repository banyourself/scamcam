import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { TextModel } from "../../src/engine/ai-review";
import { memoryLookupCache, type LookupCache } from "../../src/engine/cache";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { createApp } from "../../src/worker/app";
import { fakeNetwork, type FakeNetworkOptions } from "../engine/fake-network";

const origin = "https://scamcam.kevinle.tech";
let nextAddress = 1;

async function scan(
  body: unknown,
  network: FakeNetworkOptions = {},
  bindings: Partial<typeof env> = {},
  ip = `198.51.100.${nextAddress++}`,
  lookupCache: LookupCache | "edge" = memoryLookupCache(),
  aiModel?: TextModel,
) {
  const fake = fakeNetwork(network);
  const app = createApp({
    fetcher: fake.fetcher,
    ...(lookupCache === "edge" ? {} : { lookupCache }),
    ...(aiModel ? { aiModel } : {}),
  });
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${origin}/api/v1/scans`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": ip },
      body: JSON.stringify(body),
    }),
    { ...env, ...bindings },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { response, fake };
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM provider_usage").run();
});

describe("POST /api/v1/scans", () => {
  it("returns a valid report after the bot check passes", async () => {
    const { response, fake } = await scan({ content: "steamcommunlty.example/tradeoffer/new", turnstileToken: "token" });
    expect(response.status).toBe(200);
    const report = await response.json();
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    const siteverify = fake.requests.find((request) => request.url.includes("challenges.cloudflare.com"));
    expect(siteverify?.body).toContain(`secret=${env.TURNSTILE_SECRET_KEY}`);
    expect(siteverify?.body).toContain("response=token");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("stores nothing that was submitted", async () => {
    await scan({ content: "send me your password at https://steam-login.example/secret-path-123", turnstileToken: "token" });
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf%' AND name NOT LIKE 'sqlite%' AND name != 'd1_migrations'").all<{ name: string }>();
    for (const { name } of tables.results) {
      const rows = await env.DB.prepare(`SELECT * FROM ${name}`).all();
      const dump = JSON.stringify(rows.results);
      expect(dump).not.toContain("steam-login");
      expect(dump).not.toContain("secret-path");
      expect(dump).not.toContain("password");
    }
  });

  it("refuses requests without a passing bot check", async () => {
    const missing = await scan({ content: "hello" });
    expect(missing.response.status).toBe(403);
    expect((await missing.response.json<{ error: { code: string } }>()).error.code).toBe("bot_check_failed");
    expect(missing.fake.requests).toEqual([]);
    const rejected = await scan({ content: "hello", turnstileToken: "token" }, { turnstile: { success: false } });
    expect(rejected.response.status).toBe(403);
  });

  it("fails closed when the bot check is unreachable or not configured", async () => {
    expect((await scan({ content: "hello", turnstileToken: "token" }, { down: true })).response.status).toBe(503);
    expect((await scan({ content: "hello", turnstileToken: "token" }, {}, { TURNSTILE_SECRET_KEY: "" })).response.status).toBe(503);
  });

  it("checks the hostname on Turnstile tokens in production", async () => {
    const wrongHost = await scan({ content: "hello", turnstileToken: "token" }, { turnstile: { success: true, hostname: "evil.example" } }, { APP_ENV: "production" });
    expect(wrongHost.response.status).toBe(403);
    const rightHost = await scan({ content: "hello", turnstileToken: "token" }, {}, { APP_ENV: "production" });
    expect(rightHost.response.status).toBe(200);
  });

  it("rejects empty, oversized, and malformed input without details", async () => {
    for (const body of [{ content: "   ", turnstileToken: "t" }, { content: "x".repeat(4001), turnstileToken: "t" }, { text: "hi" }, { content: 5 }]) {
      const { response } = await scan(body);
      expect(response.status).toBe(400);
      const payload = await response.json<{ error: { code: string; message: string } }>();
      expect(payload.error.code).toBe("invalid_request");
      expect(JSON.stringify(payload)).not.toMatch(/zod|issues|expected/i);
    }
  });

  it("counts calls to quota-limited providers and stops at the daily limit", async () => {
    const bindings = { SAFE_BROWSING_API_KEY: "test-key", SAFE_BROWSING_DAILY_LIMIT: "1" };
    const first = await scan({ content: "https://www.example.org/", turnstileToken: "t" }, { safeBrowsing: () => ({}) }, bindings);
    expect((await first.response.json<{ usesGoogleSafeBrowsing: boolean }>()).usesGoogleSafeBrowsing).toBe(true);
    const second = await scan({ content: "https://www.example.org/", turnstileToken: "t" }, { safeBrowsing: () => ({}) }, bindings);
    const report = await second.response.json<{ notChecked: { name: string; reason: string }[] }>();
    expect(report.notChecked).toContainEqual({ name: "Google Safe Browsing", reason: "over_budget" });
    const usage = await env.DB.prepare("SELECT calls FROM provider_usage WHERE provider = 'safe_browsing'").first<{ calls: number }>();
    expect(usage?.calls).toBe(2);
  });

  it("reuses lookups from Cloudflare's cache across Worker instances and counts only real provider calls", async () => {
    const content = `https://login.cache-${crypto.randomUUID().slice(0, 8)}.example/verify`;
    const bindings = { SAFE_BROWSING_API_KEY: "test-key", URLHAUS_AUTH_KEY: "test-key" };
    const network = { safeBrowsing: () => ({ cacheSeconds: 300 }) };
    const providerCalls = (requests: { url: string }[]) => requests.filter((request) => !request.url.includes("challenges.cloudflare.com"));
    const first = await scan({ content, turnstileToken: "t" }, network, bindings, undefined, "edge");
    expect(first.response.status).toBe(200);
    expect(providerCalls(first.fake.requests)).toHaveLength(5);
    const second = await scan({ content, turnstileToken: "t" }, network, bindings, undefined, "edge");
    expect(second.response.status).toBe(200);
    expect(providerCalls(second.fake.requests).map((request) => new URL(request.url).hostname)).toEqual(["safebrowsing.googleapis.com"]);
    expect(second.fake.requests.some((request) => request.url.includes("challenges.cloudflare.com"))).toBe(true);
    const firstReport = await first.response.json<{ level: string; evidence: unknown[] }>();
    const secondReport = await second.response.json<{ level: string; evidence: unknown[] }>();
    expect(secondReport.level).toBe(firstReport.level);
    expect(secondReport.evidence.length).toBe(firstReport.evidence.length);
    const usage = await env.DB.prepare("SELECT provider, calls FROM provider_usage ORDER BY provider").all<{ provider: string; calls: number }>();
    expect(usage.results).toEqual([
      { provider: "safe_browsing", calls: 2 },
      { provider: "urlhaus", calls: 1 },
    ]);
  });

  it("asks no provider again when the same Worker instance repeats a scan", async () => {
    const fake = fakeNetwork({ safeBrowsing: () => ({ cacheSeconds: 300 }) });
    const app = createApp({ fetcher: fake.fetcher });
    const bindings = { ...env, SAFE_BROWSING_API_KEY: "test-key", URLHAUS_AUTH_KEY: "test-key" };
    const content = `https://login.memory-${crypto.randomUUID().slice(0, 8)}.example/verify`;
    const send = async () => {
      const ctx = createExecutionContext();
      const response = await app.fetch(
        new Request(`${origin}/api/v1/scans`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": `198.51.100.${nextAddress++}` },
          body: JSON.stringify({ content, turnstileToken: "t" }),
        }),
        bindings,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      return response;
    };
    const providerCalls = () => fake.requests.filter((request) => !request.url.includes("challenges.cloudflare.com")).length;
    expect((await send()).status).toBe(200);
    const afterFirst = providerCalls();
    expect(fake.requests.some((request) => request.url.includes("safebrowsing.googleapis.com"))).toBe(true);
    expect((await send()).status).toBe(200);
    expect(providerCalls()).toBe(afterFirst);
  });

  it("runs the AI check on inconclusive messages and counts it against the daily AI limit", async () => {
    const calls: string[] = [];
    const model: TextModel = {
      async run(id) {
        calls.push(id);
        return { response: "payment_pressure", usage: { prompt_tokens: 320, completion_tokens: 2 } };
      },
    };
    const content = "i sent you 40 dollars by accident on paypal, can you send it back to my other account please";
    const on = await scan({ content, turnstileToken: "t" }, {}, { AI_MODE: "inconclusive" }, undefined, undefined, model);
    const report = await on.response.json<{ level: string; evidence: { source: { name: string } }[] }>();
    expect(calls).toEqual(["@cf/qwen/qwen3-30b-a3b-fp8"]);
    expect(report.level).toBe("suspicious");
    expect(report.evidence[0]!.source.name).toBe("AI pattern check (Workers AI)");
    const usage = await env.DB.prepare("SELECT calls FROM provider_usage WHERE provider = 'workers_ai'").first<{ calls: number }>();
    expect(usage?.calls).toBe(1);
    await scan({ content, turnstileToken: "t" }, {}, { AI_MODE: "off" }, undefined, undefined, model);
    expect(calls).toHaveLength(1);
  });

  it("does not run the AI check when its usage cannot be counted", async () => {
    const calls: string[] = [];
    const model: TextModel = {
      async run(id) {
        calls.push(id);
        return { response: "none" };
      },
    };
    await env.DB.prepare("INSERT INTO app_state (key, value, updated_at) VALUES ('writes_paused', 'true', 0) ON CONFLICT (key) DO UPDATE SET value = 'true'").run();
    try {
      const { response } = await scan({ content: "i sent you 40 dollars by accident, can you send it back please", turnstileToken: "t" }, {}, { AI_MODE: "inconclusive" }, undefined, undefined, model);
      const report = await response.json<{ notChecked: { name: string; reason: string }[] }>();
      expect(calls).toEqual([]);
      expect(report.notChecked).toContainEqual({ name: "AI pattern check (Workers AI)", reason: "over_budget" });
    } finally {
      await env.DB.prepare("DELETE FROM app_state WHERE key = 'writes_paused'").run();
    }
  });

  it("limits how many checks one visitor can run per minute", async () => {
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const { response } = await scan({ content: "hello there", turnstileToken: "t" }, {}, {}, "192.0.2.77");
      statuses.push(response.status);
      last = response;
    }
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses).toContain(429);
    expect(last?.headers.get("Retry-After")).toBe("60");
  });

  it("is documented in the OpenAPI file", async () => {
    const app = createApp();
    const ctx = createExecutionContext();
    const response = await app.fetch(new Request(`${origin}/api/v1/openapi.json`), env, ctx);
    const doc = await response.json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(doc.paths)).toContain("/api/v1/scans");
  });
});
