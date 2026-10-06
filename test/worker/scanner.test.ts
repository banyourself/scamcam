import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryLookupCache } from "../../src/engine/cache";
import type { ScanReport } from "../../src/shared/report";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { reportSignatureHeader } from "../../src/shared/share";
import { createApp } from "../../src/worker/app";
import { scanInScanner, scannerName } from "../../src/worker/scanner";
import { reportIsAuthentic } from "../../src/worker/security/report-signature";
import { fakeNetwork } from "../engine/fake-network";

const origin = "https://scamcam.kevinle.tech";
const message = "hey, send me your 2fa code so I can verify the trade before it expires";
let nextAddress = 1;

async function scanThroughApi(bindings: Partial<typeof env> = {}) {
  const fake = fakeNetwork();
  const app = createApp({ fetcher: fake.fetcher, lookupCache: memoryLookupCache(), scans: "scanner" });
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${origin}/api/v1/scans`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": `192.0.2.${nextAddress++}` },
      body: JSON.stringify({ content: message, turnstileToken: "token" }),
    }),
    { ...env, ...bindings },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { response, fake };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scanner Durable Object", () => {
  it("returns a valid report with a signature the Worker accepts", async () => {
    const outcome = await scanInScanner(env.SCANNER, message);
    expect(ScanReportSchema.safeParse(outcome.report).success).toBe(true);
    expect(outcome.report.level).toBe("high_risk");
    expect(outcome.signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await reportIsAuthentic(outcome.report, outcome.signature!, env.SHARE_SIGNING_KEY)).toBe(true);
  });

  it("keeps one named object so its caches stay warm", async () => {
    const first = env.SCANNER.idFromName(scannerName);
    const second = env.SCANNER.idFromName(scannerName);
    expect(first.equals(second)).toBe(true);
  });

  it("runs scans from the API after the bot check in the Worker", async () => {
    const { response, fake } = await scanThroughApi();
    expect(response.status).toBe(200);
    const report = await response.json<ScanReport>();
    expect(report.level).toBe("high_risk");
    const signature = response.headers.get(reportSignatureHeader);
    expect(await reportIsAuthentic(report, signature!, env.SHARE_SIGNING_KEY)).toBe(true);
    expect(fake.requests.map((request) => new URL(request.url).hostname)).toEqual(["challenges.cloudflare.com"]);
  });

  it("does not reach the scanner when the bot check fails", async () => {
    const scan = vi.fn();
    const fake = fakeNetwork({ turnstile: { success: false, "error-codes": ["invalid-input-response"] } });
    const app = createApp({ fetcher: fake.fetcher, lookupCache: memoryLookupCache(), scans: "scanner" });
    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request(`${origin}/api/v1/scans`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": `192.0.2.${nextAddress++}` },
        body: JSON.stringify({ content: message, turnstileToken: "token" }),
      }),
      { ...env, SCANNER: { idFromName: () => ({}), get: () => ({ scan }) } as unknown as typeof env.SCANNER },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
    expect(scan).not.toHaveBeenCalled();
  });

  it("falls back to scanning in the Worker when the scanner fails", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const broken = {
      idFromName: () => ({}),
      get: () => ({ scan: () => Promise.reject(new Error("overloaded")) }),
    } as unknown as typeof env.SCANNER;
    const { response } = await scanThroughApi({ SCANNER: broken });
    expect(response.status).toBe(200);
    expect((await response.json<ScanReport>()).level).toBe("high_risk");
    expect(response.headers.get(reportSignatureHeader)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const alerts = log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>).filter((entry) => entry.event === "alert");
    expect(alerts).toEqual([expect.objectContaining({ task: "scan", alert: "scanner_unavailable", reason: "Error" })]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("2fa");
  });

  it("scans in the Worker when no scanner is bound", async () => {
    const { response } = await scanThroughApi({ SCANNER: undefined as unknown as typeof env.SCANNER });
    expect(response.status).toBe(200);
    expect((await response.json<ScanReport>()).level).toBe("high_risk");
  });
});
