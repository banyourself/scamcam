import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { memoryLookupCache } from "../../src/engine/cache";
import { createApp } from "../../src/worker/app";
import { rateLimitKey } from "../../src/worker/middleware/rate-limit";
import { fakeNetwork } from "../engine/fake-network";

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
