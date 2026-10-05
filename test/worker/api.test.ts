import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createApp, maxRequestBytes } from "../../src/worker/app";

const origin = "https://scamcam.kevinle.tech";

async function call(path: string, init: RequestInit = {}, app = createApp()) {
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(origin + path, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("health endpoint", () => {
  it("reports that the API is running without claiming scanning works yet", async () => {
    const response = await call("/api/v1/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      version: env.APP_VERSION,
      environment: env.APP_ENV,
      scanning: "not_yet_available",
    });
  });

  it("sends strict security headers and a request id", async () => {
    const response = await call("/api/v1/health");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Request-Id")).toMatch(/^[\w-]{8,64}$/);
  });
});

describe("error handling", () => {
  it("returns a generic JSON 404 for unknown endpoints", async () => {
    const response = await call("/api/v1/does-not-exist");
    expect(response.status).toBe(404);
    const body = await response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("not_found");
    expect(JSON.stringify(body)).not.toMatch(/stack|at \w+ \(/);
  });

  it("hides internal error details and records only the error type", async () => {
    const app = createApp();
    app.get("/api/v1/explode", () => {
      throw new TypeError("database password is hunter2");
    });
    const response = await call("/api/v1/explode", {}, app);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("TypeError");
    const row = await env.DB.prepare("SELECT code, route, expires_at - created_at AS ttl FROM error_events ORDER BY id DESC")
      .first<{ code: string; route: string; ttl: number }>();
    expect(row).toEqual({ code: "TypeError", route: "/api/v1/explode", ttl: 7 * 24 * 60 * 60 });
  });

  it("rejects request bodies over the size limit", async () => {
    const response = await call("/api/v1/health", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ text: "x".repeat(maxRequestBytes + 10) }),
    });
    expect(response.status).toBe(413);
  });

  it("blocks cross-site form posts", async () => {
    const response = await call("/api/v1/health", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://evil.example" },
      body: "a=1",
    });
    expect(response.status).toBe(403);
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once a client exceeds the limit", async () => {
    const headers = { "CF-Connecting-IP": "203.0.113.77" };
    let limited: Response | null = null;
    for (let attempt = 0; attempt < 80 && !limited; attempt += 1) {
      const response = await call("/api/v1/health", { headers });
      if (response.status === 429) {
        limited = response;
      }
    }
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("Retry-After")).toBe("60");
    const other = await call("/api/v1/health", { headers: { "CF-Connecting-IP": "203.0.113.78" } });
    expect(other.status).toBe(200);
  });
});

describe("OpenAPI document", () => {
  it("documents the health endpoint", async () => {
    const response = await call("/api/v1/openapi.json");
    expect(response.status).toBe(200);
    const doc = await response.json<{ openapi: string; paths: Record<string, unknown> }>();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/api/v1/health");
  });
});
