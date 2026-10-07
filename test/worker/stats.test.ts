import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryLookupCache } from "../../src/engine/cache";
import type { StatsResponse } from "../../src/shared/api";
import type { ScanReport } from "../../src/shared/report";
import { createApp } from "../../src/worker/app";
import { countScan, deleteExpiredTotals, utcDay } from "../../src/worker/repositories/scan-totals";
import { nowInSeconds } from "../../src/worker/retention";
import { fakeNetwork } from "../engine/fake-network";

const origin = "https://scamcam.kevinle.tech";
const message = "hey its marker-stats-qz7 from the club, you won a skin, log in at steam-trade-stats.example/login to claim";
let nextAddress = 1;

async function call(path: string, init: RequestInit = {}) {
  const app = createApp({ fetcher: fakeNetwork({}).fetcher, lookupCache: memoryLookupCache() });
  const ctx = createExecutionContext();
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", `198.51.100.${(nextAddress++ % 200) + 1}`);
  if (init.method === "POST") {
    headers.set("Content-Type", "application/json");
    headers.set("Origin", origin);
  }
  const response = await app.fetch(new Request(`${origin}${path}`, { ...init, headers }), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("anonymous totals", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM scan_totals").run();
  });

  it("counts a scan by day, kind, and level, and stores nothing else", async () => {
    const response = await call("/api/v1/scans", { method: "POST", body: JSON.stringify({ content: message, turnstileToken: "t" }) });
    expect(response.status).toBe(200);
    const report = await response.json<ScanReport>();
    const rows = await env.DB.prepare("SELECT * FROM scan_totals").all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    const row = rows.results[0]!;
    expect(Object.keys(row).sort()).toEqual(["count", "day", "expires_at", "kind", "level"]);
    expect(row).toMatchObject({ day: utcDay(nowInSeconds()), kind: report.subject.kind, level: report.level, count: 1 });
    expect(JSON.stringify(rows.results)).not.toContain("marker-stats-qz7");
    expect(JSON.stringify(rows.results)).not.toContain("steam-trade-stats");
  });

  it("adds up the last 7 and 30 days and ignores older rows", async () => {
    const now = nowInSeconds();
    await countScan(env.DB, "url", "high_risk", now);
    await countScan(env.DB, "url", "high_risk", now);
    await countScan(env.DB, "message", "no_known_threat", now);
    await countScan(env.DB, "file", "suspicious", now - 10 * 86_400);
    await countScan(env.DB, "url", "confirmed_malicious", now - 45 * 86_400);
    const response = await call("/api/v1/stats");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const stats = await response.json<StatsResponse>();
    expect(stats.last7).toMatchObject({ checks: 3, flagged: 2, byKind: { url: 2, message: 1, file: 0 } });
    expect(stats.last7.byLevel).toMatchObject({ high_risk: 2, no_known_threat: 1, suspicious: 0 });
    expect(stats.last30).toMatchObject({ checks: 4, flagged: 3, byKind: { url: 2, message: 1, file: 1 } });
    expect(stats.last30.byLevel.confirmed_malicious).toBe(0);
  });

  it("keeps each counter for 90 days", async () => {
    const now = nowInSeconds();
    await countScan(env.DB, "url", "unknown", now);
    const row = await env.DB.prepare("SELECT expires_at FROM scan_totals").first<{ expires_at: number }>();
    expect(row!.expires_at).toBe(now + 90 * 86_400);
    expect(await deleteExpiredTotals(env.DB, now + 89 * 86_400)).toBe(0);
    expect(await deleteExpiredTotals(env.DB, now + 90 * 86_400)).toBe(1);
  });
});
