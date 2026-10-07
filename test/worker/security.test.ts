import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { TextModel } from "../../src/engine/ai-review";
import { createLookupState, memoryLookupCache } from "../../src/engine/cache";
import { buildShards, domainListKeepSeconds } from "../../src/engine/domain-list";
import { createApp } from "../../src/worker/app";
import { runScan } from "../../src/worker/scan-runner";
import { rateLimitKey } from "../../src/worker/middleware/rate-limit";
import { domainListStatements } from "../../src/worker/repositories/domain-list-sql";
import { nowInSeconds } from "../../src/worker/retention";
import { fakeNetwork, fakeSpamhaus } from "../engine/fake-network";
import { countingCache, countingDatabase, freePlanSubrequestLimit } from "./counting";

const origin = "https://scamcam.kevinle.tech";
let nextAddress = 1;

async function send(path: string, init: RequestInit, ip = `198.51.100.${(nextAddress++ % 200) + 1}`) {
  const fake = fakeNetwork();
  const app = createApp({ fetcher: fake.fetcher, lookupCache: memoryLookupCache() });
  const ctx = createExecutionContext();
  const headers = new Headers(init.headers);
  if (!headers.has("CF-Connecting-IP")) {
    headers.set("CF-Connecting-IP", ip);
  }
  const response = await app.fetch(new Request(`${origin}${path}`, { ...init, headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { response, fake };
}

const json = (body: unknown, extra: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin, ...extra },
  body: JSON.stringify(body),
});

describe("rate limit keys", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["2001:db8:85a3:12:8a2e:370:7334:1", "2001:0db8:85a3:0012::/64"],
    ["2001:db8:85a3:12::99", "2001:0db8:85a3:0012::/64"],
    ["2001:DB8:85A3:12:ffff::1", "2001:0db8:85a3:0012::/64"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::ffff:cb00:7107", "203.0.113.7"],
    ["not an address", "not an address"],
  ])("keys %s as %s", (address, key) => {
    expect(rateLimitKey(new Request(origin, { headers: { "CF-Connecting-IP": address } }))).toBe(key);
  });

  it("shares one scan limit across a whole IPv6 /64 and ignores X-Forwarded-For", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 13; attempt += 1) {
      const { response } = await send(
        "/api/v1/scans",
        json({ content: "hello there", turnstileToken: "t" }, { "X-Forwarded-For": `192.0.2.${attempt}` }),
        `2001:db8:abcd:42::${(attempt + 1).toString(16)}`,
      );
      statuses.push(response.status);
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(10);
    expect(statuses.slice(10).every((status) => status === 429)).toBe(true);
    const other = await send("/api/v1/scans", json({ content: "hello there", turnstileToken: "t" }), "2001:db8:abcd:43::1");
    expect(other.response.status).toBe(200);
  });

  it("holds the scan limit when many requests arrive at once", async () => {
    const results = await Promise.all(
      Array.from({ length: 16 }, () => send("/api/v1/scans", json({ content: "hello there", turnstileToken: "t" }), "203.0.113.99")),
    );
    const statuses = results.map(({ response }) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(10);
    expect(statuses.filter((status) => status === 429)).toHaveLength(6);
  });
});

describe("API abuse and cross-origin requests", () => {
  it("rejects unexpected fields", async () => {
    const { response } = await send("/api/v1/scans", json({ content: "hello", turnstileToken: "t", admin: true }));
    expect(response.status).toBe(400);
  });

  it("blocks cross-site text posts and sends no CORS headers", async () => {
    const crossSite = await send("/api/v1/scans", {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: "https://evil.example" },
      body: JSON.stringify({ content: "hello", turnstileToken: "t" }),
    });
    expect(crossSite.response.status).toBe(403);
    const preflight = await send("/api/v1/scans", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    });
    expect(preflight.response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const read = await send("/api/v1/scans", { method: "GET" });
    expect([404, 405]).toContain(read.response.status);
    expect(read.response.headers.get("Content-Type")).toContain("application/json");
  });

  it("never contacts internal or submitted addresses", async () => {
    const content = "check http://169.254.169.254/latest/meta-data and http://127.0.0.1:8787/admin and http://localhost/ and http://[::1]/ and http://10.0.0.5/";
    const { response, fake } = await send("/api/v1/scans", json({ content, turnstileToken: "t" }));
    expect(response.status).toBe(200);
    const hosts = fake.requests.map((request) => new URL(request.url).hostname);
    for (const forbidden of ["169.254.169.254", "127.0.0.1", "localhost", "[::1]", "10.0.0.5"]) {
      expect(hosts).not.toContain(forbidden);
    }
  });

  it("always makes its own request ID instead of trusting one sent by the client", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const { response } = await send("/api/v1/health", { headers: { "X-Request-Id": "chosen-by-the-client_123" } });
      const id = response.headers.get("X-Request-Id") ?? "";
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      const lines = log.mock.calls.map(([line]) => String(line)).join(" ");
      expect(lines).toContain(id);
      expect(lines).not.toContain("chosen-by-the-client");
    } finally {
      log.mockRestore();
    }
  });

  it("treats SQL in a message as plain text", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table'").first<{ total: number }>();
    const { response } = await send("/api/v1/scans", json({ content: "hi'); DROP TABLE provider_usage; -- and \" OR 1=1 --", turnstileToken: "t" }));
    expect(response.status).toBe(200);
    const after = await env.DB.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table'").first<{ total: number }>();
    expect(after?.total).toBe(before?.total);
  });

  it("answers huge bodies with a short error", async () => {
    const { response } = await send("/api/v1/scans", json({ content: "a".repeat(20_000), turnstileToken: "t" }));
    expect(response.status).toBe(413);
    const body = await response.text();
    expect(body.length).toBeLessThan(300);
  });
});

describe("Workers Free plan limits", () => {
  it("keeps a message with 20 links and every source switched on under 50 subrequests", async () => {
    const now = nowInSeconds();
    const statements = domainListStatements({
      list: "phishing_database",
      version: "limits-test",
      syncedAt: now,
      expiresAt: now + domainListKeepSeconds,
      shards: await buildShards(["listed-scam.example"]),
    });
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
    try {
      const queries = { queries: 0 };
      const { cache, counter } = countingCache();
      const fake = fakeNetwork({ safeBrowsing: () => ({ cacheSeconds: 300 }) });
      const model: TextModel = {
        async run() {
          return { response: "none" };
        },
      };
      const app = createApp({ fetcher: fake.fetcher, lookupCache: cache, aiModel: model });
      const links = Array.from({ length: 20 }, (_, index) => `https://login.secure${index}.account-check${index}.example/a/b/c/d?x=${index}`);
      const bindings = { ...env, DB: countingDatabase(env.DB, queries), SAFE_BROWSING_API_KEY: "k", URLHAUS_AUTH_KEY: "k", AI_MODE: "inconclusive" };
      const ctx = createExecutionContext();
      const response = await app.fetch(
        new Request(`${origin}/api/v1/scans`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": "192.0.2.250" },
          body: JSON.stringify({ content: `my friend sent these, are they ok? ${links.join(" ")}`, turnstileToken: "t" }),
        }),
        bindings,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      expect(response.status).toBe(200);
      const used = { fetches: fake.requests.length, cacheCalls: counter.calls, queries: queries.queries };
      console.log(JSON.stringify({ subrequestsForTwentyLinks: used }));
      expect(used.fetches + used.cacheCalls + used.queries, JSON.stringify(used)).toBeLessThan(freePlanSubrequestLimit);
    } finally {
      await env.DB.batch([env.DB.prepare("DELETE FROM domain_list_shards"), env.DB.prepare("DELETE FROM domain_lists")]);
    }
  });

  it("keeps the scanner's extra checks for a message with 20 links under 50 subrequests", async () => {
    const queries = { queries: 0 };
    const asked: string[][] = [];
    const fake = fakeNetwork({ safeBrowsing: () => ({ cacheSeconds: 300 }), radar: {} });
    const links = Array.from({ length: 20 }, (_, index) => `https://login.secure${index}.account-check${index}.example/a/b/c/d?x=${index}`);
    const bindings = {
      ...env,
      DB: countingDatabase(env.DB, queries),
      SAFE_BROWSING_API_KEY: "k",
      URLHAUS_AUTH_KEY: "k",
      SPAMHAUS_DQS_KEY: "0".repeat(26),
      PHISHSTATS_API_KEY: "psk_test",
      CLOUDFLARE_RADAR_TOKEN: "radar-test-token",
    };
    const { report } = await runScan(bindings, `my friend sent these, are they ok? ${links.join(" ")}`, {
      fetcher: fake.fetcher,
      lookups: { cache: memoryLookupCache(), state: createLookupState(), clock: Date.now },
      aiModel: null,
      extendedLookups: true,
      dnsTransport: fakeSpamhaus({}, asked),
    });
    expect(report.notChecked.map((item) => item.name)).not.toContain("Spamhaus DBL and ZRD");
    const used = { fetches: fake.requests.length, spamhausLookups: asked.flat().length, queries: queries.queries };
    console.log(JSON.stringify({ scannerSubrequestsForTwentyLinks: used }));
    expect(asked).toHaveLength(1);
    expect(used.spamhausLookups).toBeLessThanOrEqual(6);
    expect(fake.requests.filter((request) => request.url.includes("phishstats"))).toHaveLength(1);
    expect(fake.requests.filter((request) => request.url.includes("/radar/")).length).toBeLessThanOrEqual(2);
    expect(used.fetches + used.spamhausLookups + used.queries, JSON.stringify(used)).toBeLessThan(freePlanSubrequestLimit);
  });
});
