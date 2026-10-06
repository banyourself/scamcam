import { describe, expect, it } from "vitest";
import { verifyTurnstileToken } from "../../src/worker/security/turnstile";

function fakeFetch(body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const base = { token: "token", secret: "secret", remoteIp: "203.0.113.1", expectedHostname: "scamcam.kevinle.tech" };

describe("Turnstile verification", () => {
  it("fails closed when no secret is configured", async () => {
    expect(await verifyTurnstileToken({ ...base, secret: undefined })).toEqual({ ok: false, reason: "not_configured" });
  });

  it("rejects missing and oversized tokens without calling Cloudflare", async () => {
    let called = false;
    const fetcher: typeof fetch = async () => {
      called = true;
      return new Response("{}");
    };
    expect(await verifyTurnstileToken({ ...base, token: undefined, fetcher })).toEqual({ ok: false, reason: "missing_token" });
    expect(await verifyTurnstileToken({ ...base, token: "x".repeat(3000), fetcher })).toEqual({ ok: false, reason: "missing_token" });
    expect(called).toBe(false);
  });

  it("accepts a successful check for the expected hostname", async () => {
    const result = await verifyTurnstileToken({ ...base, fetcher: fakeFetch({ success: true, hostname: base.expectedHostname }) });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a token issued for another hostname", async () => {
    const result = await verifyTurnstileToken({ ...base, fetcher: fakeFetch({ success: true, hostname: "evil.example" }) });
    expect(result).toEqual({ ok: false, reason: "rejected" });
  });

  it("rejects a token issued for another action when an action is expected", async () => {
    const answer = (action: string) => verifyTurnstileToken({ ...base, expectedAction: "scan", fetcher: fakeFetch({ success: true, hostname: base.expectedHostname, action }) });
    expect(await answer("scan")).toEqual({ ok: true });
    expect(await answer("login")).toEqual({ ok: false, reason: "rejected" });
  });

  it("rejects failed or malformed responses", async () => {
    expect(await verifyTurnstileToken({ ...base, fetcher: fakeFetch({ success: false }) })).toEqual({ ok: false, reason: "rejected" });
    expect(await verifyTurnstileToken({ ...base, fetcher: fakeFetch({ nope: 1 }) })).toEqual({ ok: false, reason: "rejected" });
  });

  it("reports an unreachable service", async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error("offline");
    };
    expect(await verifyTurnstileToken({ ...base, fetcher })).toEqual({ ok: false, reason: "unreachable" });
  });
});
