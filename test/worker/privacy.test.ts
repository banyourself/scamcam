import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { TextModel } from "../../src/engine/ai-review";
import { memoryLookupCache, type LookupCache } from "../../src/engine/cache";
import { dohEndpoint, filteredDohEndpoint } from "../../src/engine/dns";
import { urlhausHostEndpoint } from "../../src/engine/urlhaus";
import { createApp } from "../../src/worker/app";
import { fakeNetwork, type FakeNetwork } from "../engine/fake-network";

const origin = "https://scamcam.kevinle.tech";
const message =
  "hey it's privacy marker from the club, the saturday photos are at https://marker-host-qz7.example/marker-path-qz7?ticket=marker-query-qz7 " +
  "and you can reach marker-mail-qz7@example.com or +1 555 010 4477, the locker code is 918273";
const textMarkers = ["privacy marker", "saturday photos", "marker-path", "marker-query", "marker-mail", "555 010", "5550104477", "918273"];
const hostMarker = "marker-host";
const keyed = { SAFE_BROWSING_API_KEY: "test-key", URLHAUS_AUTH_KEY: "test-key", AI_MODE: "inconclusive" };
let nextAddress = 1;

function recordingCache(): { cache: LookupCache; entries: string[] } {
  const inner = memoryLookupCache();
  const entries: string[] = [];
  return {
    entries,
    cache: {
      get: (key) => {
        entries.push(key);
        return inner.get(key);
      },
      put: async (key, value, ttlSeconds) => {
        entries.push(`${key} ${JSON.stringify(value)}`);
        await inner.put(key, value, ttlSeconds);
      },
    },
  };
}

function recordingModel(): { model: TextModel; inputs: string[] } {
  const inputs: string[] = [];
  return {
    inputs,
    model: {
      async run(_, input) {
        inputs.push(JSON.stringify(input));
        return { response: "none", usage: { prompt_tokens: 300, completion_tokens: 1 } };
      },
    },
  };
}

async function send(body: unknown, options: { cache?: LookupCache; model?: TextModel; turnstile?: unknown } = {}): Promise<{ response: Response; fake: FakeNetwork }> {
  const fake = fakeNetwork(options.turnstile ? { turnstile: options.turnstile } : {});
  const app = createApp({ fetcher: fake.fetcher, lookupCache: options.cache ?? memoryLookupCache(), ...(options.model ? { aiModel: options.model } : {}) });
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${origin}/api/v1/scans`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": `192.0.2.${nextAddress++}` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { ...env, ...keyed },
    ctx,
  );
  await response.arrayBuffer();
  await waitOnExecutionContext(ctx);
  return { response, fake };
}

function found(text: string, markers: string[]): string[] {
  const lowered = text.toLowerCase();
  return markers.filter((marker) => lowered.includes(marker));
}

describe("submitted text stays out of logs, caches, and outside requests", () => {
  const spies: MockInstance[] = [];
  const logged = () => spies.flatMap((spy) => spy.mock.calls.map((call) => call.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "))).join("\n");

  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM provider_usage").run();
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      spies.push(vi.spyOn(console, level).mockImplementation(() => undefined));
    }
  });

  afterEach(() => {
    for (const spy of spies.splice(0)) {
      spy.mockRestore();
    }
  });

  it("logs no part of a message, its links, or its contact details on any path", async () => {
    const { model } = recordingModel();
    const ok = await send({ content: message, turnstileToken: "t" }, { model });
    expect(ok.response.status).toBe(200);
    expect((await send({ content: message, turnstileToken: "t", extra: message })).response.status).toBe(400);
    expect((await send({ content: message.repeat(100), turnstileToken: "t" })).response.status).toBe(413);
    expect((await send({ content: message, turnstileToken: "t" }, { turnstile: { success: false } })).response.status).toBe(403);
    expect((await send(`{"content": "${message}", broken`)).response.status).toBe(400);
    const failing: TextModel = {
      async run() {
        throw new Error(`model failed on ${message}`);
      },
    };
    expect((await send({ content: message, turnstileToken: "t" }, { model: failing })).response.status).toBe(200);
    const output = logged();
    expect(output).toContain('"event":"request"');
    expect(output).toContain('"event":"ai_review"');
    expect(found(output, [...textMarkers, hostMarker])).toEqual([]);
  });

  it("keeps only hashed keys and provider answers in the lookup cache", async () => {
    const { cache, entries } = recordingCache();
    const { response } = await send({ content: message, turnstileToken: "t" }, { cache, model: recordingModel().model });
    expect(response.status).toBe(200);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toMatch(/^[a-z:_-]+\/[0-9a-f]{32}( |$)/);
    }
    expect(found(entries.join("\n"), [...textMarkers, hostMarker])).toEqual([]);
  });

  it("sends outside sources only a hostname or hash prefixes, and the AI only the redacted words", async () => {
    const { model, inputs } = recordingModel();
    const { response, fake } = await send({ content: message, turnstileToken: "t" }, { model });
    expect(response.status).toBe(200);
    expect(inputs).toHaveLength(1);
    expect(found(inputs.join("\n"), ["marker-path", "marker-query", "marker-mail", hostMarker, "555 010", "918273"])).toEqual([]);
    expect(inputs[0]).toContain("saturday photos");
    const hostnameSources = [dohEndpoint, filteredDohEndpoint, urlhausHostEndpoint, "https://rdap.registry.test/"];
    for (const request of fake.requests) {
      const sent = `${decodeURIComponent(request.url)} ${request.body}`;
      expect(found(sent, textMarkers)).toEqual([]);
      if (!hostnameSources.some((source) => request.url.startsWith(source))) {
        expect(found(sent, [hostMarker])).toEqual([]);
      }
    }
    expect(fake.requests.some((request) => request.url.startsWith("https://safebrowsing.googleapis.com/"))).toBe(true);
  });
});
