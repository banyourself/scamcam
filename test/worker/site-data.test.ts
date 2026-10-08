import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryLookupCache } from "../../src/engine/cache";
import type { SiteDataset } from "../../src/shared/site-data";
import { createApp } from "../../src/worker/app";
import { fakeNetwork } from "../engine/fake-network";

const origin = "https://scamcam.kevinle.tech";
let nextAddress = 1;

async function get(path: string) {
  const fake = fakeNetwork({});
  const app = createApp({ fetcher: fake.fetcher, lookupCache: memoryLookupCache() });
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`${origin}${path}`, { headers: { "CF-Connecting-IP": `198.51.100.${(nextAddress++ % 200) + 1}` } }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { response, fake };
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function store(dataset: SiteDataset, data: unknown, version: string, partSize = 40, override: { parts?: number; bytes?: number } = {}) {
  const bytes = await gzip(JSON.stringify(data));
  const encoded = base64(bytes);
  const parts: string[] = [];
  for (let start = 0; start < encoded.length; start += partSize) {
    parts.push(encoded.slice(start, start + partSize));
  }
  await env.DB.batch([
    ...parts.map((part, index) => env.DB.prepare("INSERT INTO site_data_parts (dataset, version, part, body) VALUES (?, ?, ?, ?)").bind(dataset, version, index, part)),
    env.DB.prepare(
      "INSERT INTO site_data (dataset, version, parts, bytes, built_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (dataset) DO UPDATE SET version = excluded.version, parts = excluded.parts, bytes = excluded.bytes, built_at = excluded.built_at",
    ).bind(dataset, version, override.parts ?? parts.length, override.bytes ?? bytes.length, 1_791_500_000),
  ]);
  return bytes;
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM site_data_parts"), env.DB.prepare("DELETE FROM site_data")]);
});

describe("site data endpoints", () => {
  it("say the data is not ready before the first build, without asking anyone", async () => {
    for (const path of ["/api/v1/site-security", "/api/v1/breach-notices"]) {
      const { response, fake } = await get(path);
      expect(response.status).toBe(503);
      expect((await response.json<{ error: { code: string } }>()).error.code).toBe("unavailable");
      expect(fake.requests).toHaveLength(0);
    }
  });

  it("join the stored parts back into the exact gzip file, with API security headers", async () => {
    const data = { v: 1, builtAt: "2026-10-08T23:00:00.000Z", sites: [{ d: "discord.com", m: 19, cp: "https://discord.com/settings/account" }] };
    const bytes = await store("site-security", data, "0123456789abcdef");
    const { response, fake } = await get("/api/v1/site-security");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/gzip");
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-transform");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(response.headers.get("X-Data-Version")).toBe("0123456789abcdef");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(bytes);
    const json = await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip"))).json();
    expect(json).toEqual(data);
    expect(fake.requests).toHaveLength(0);
  });

  it("refuse a copy with missing parts or the wrong size instead of serving a broken file", async () => {
    await store("breach-notices", { v: 1, builtAt: "x", notices: [] }, "fedcba9876543210", 40, { parts: 99 });
    expect((await get("/api/v1/breach-notices")).response.status).toBe(503);
    await store("breach-notices", { v: 1, builtAt: "x", notices: [] }, "fedcba9876543211", 40, { bytes: 1 });
    expect((await get("/api/v1/breach-notices")).response.status).toBe(503);
  });

  it("serve only the current version while an older one is still being removed", async () => {
    await store("breach-notices", { v: 1, builtAt: "old", notices: [] }, "aaaaaaaaaaaaaaaa", 10_000);
    const current = { v: 1, builtAt: "new", notices: [{ s: "ca", n: "Example Games LLC", r: "2026-10-06" }] };
    await store("breach-notices", current, "bbbbbbbbbbbbbbbb", 10_000);
    const { response } = await get("/api/v1/breach-notices");
    expect(response.headers.get("X-Data-Version")).toBe("bbbbbbbbbbbbbbbb");
    const json = await new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))).json();
    expect(json).toEqual(current);
  });
});
