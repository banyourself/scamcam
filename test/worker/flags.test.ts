import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryLookupCache } from "../../src/engine/cache";
import type { ScanReport } from "../../src/shared/report";
import { reportSignatureHeader } from "../../src/shared/share";
import { createApp } from "../../src/worker/app";
import { writeAppState, appStateKeys } from "../../src/worker/repositories/app-state";
import { signReport } from "../../src/worker/security/report-signature";
import { nowInSeconds } from "../../src/worker/retention";
import { fakeNetwork, type FakeNetworkOptions } from "../engine/fake-network";

const origin = "https://scamcam.kevinle.tech";
const message = "hey its marker-flag-qz9 from the club, you won a skin, log in at steam-trade-flag.example/login to claim";
let nextAddress = 1;

async function call(path: string, init: RequestInit = {}, bindings: Partial<typeof env> = {}, network: FakeNetworkOptions = {}) {
  const app = createApp({ fetcher: fakeNetwork(network).fetcher, lookupCache: memoryLookupCache() });
  const ctx = createExecutionContext();
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", headers.get("CF-Connecting-IP") ?? `203.0.113.${(nextAddress++ % 200) + 1}`);
  if (init.method === "POST") {
    headers.set("Content-Type", "application/json");
    headers.set("Origin", origin);
  }
  const response = await app.fetch(new Request(`${origin}${path}`, { ...init, headers }), { ...env, ...bindings }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function scanned(content = message): Promise<{ report: ScanReport; signature: string }> {
  const response = await call("/api/v1/scans", { method: "POST", body: JSON.stringify({ content, turnstileToken: "t" }) });
  expect(response.status).toBe(200);
  const signature = response.headers.get(reportSignatureHeader);
  expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { report: await response.json<ScanReport>(), signature: signature! };
}

async function flag(body: Record<string, unknown>, options: { ip?: string; bindings?: Partial<typeof env>; network?: FakeNetworkOptions } = {}) {
  return call(
    "/api/v1/flags",
    { method: "POST", body: JSON.stringify({ turnstileToken: "t", ...body }), headers: options.ip ? { "CF-Connecting-IP": options.ip } : {} },
    options.bindings,
    options.network,
  );
}

async function storedFlags() {
  return (await env.DB.prepare("SELECT * FROM result_flags ORDER BY created_at").all<Record<string, unknown>>()).results;
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM result_flags"), env.DB.prepare("DELETE FROM app_state")]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("flagging a result for review", () => {
  it("keeps the result, the evidence names, and the domain for 30 days, never the message", async () => {
    const { report, signature } = await scanned();
    const note = "I own this site, mail me at kevin@example.com or 555 123 4567 \u001b[31mred\u001b[0m \u202Eevil";
    const response = await flag({ report, signature, reason: "safe_but_warned", note });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "received" });
    const rows = await storedFlags();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      case_number: report.caseNumber,
      kind: "message",
      level: report.level,
      subject: "steam-trade-flag.example",
      evidence: report.evidence.map((item) => item.id).join(" "),
      reason: "safe_but_warned",
    });
    expect(row.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(row.report_key).toMatch(/^[0-9a-f]{32}$/);
    expect(row.note).toBe("I own this site, mail me at [email hidden] or [number hidden] [31mred [0m evil");
    expect(Number(row.expires_at) - Number(row.created_at)).toBe(30 * 86_400);
    const dump = JSON.stringify(rows);
    for (const secret of ["marker-flag", "kevin@example.com", "4567", signature, "\u001b", "\u202E"]) {
      expect(dump).not.toContain(secret);
    }
  });

  it("stores a file's fingerprint and a link's host, not the full link", async () => {
    const { report, signature } = await scanned("https://steamcommunlty.example/tradeoffer/new/?partner=12&token=secret-token-value");
    expect(report.subject.kind).toBe("url");
    expect((await flag({ report, signature, reason: "detail_wrong" })).status).toBe(202);
    const [row] = await storedFlags();
    expect(row?.subject).toBe(report.subject.registrableDomain ?? "steamcommunlty.example");
    expect(JSON.stringify(row)).not.toContain("secret-token-value");
    expect(row?.note).toBeNull();
  });

  it("keeps one flag per report", async () => {
    const { report, signature } = await scanned();
    expect(await (await flag({ report, signature, reason: "safe_but_warned" })).json()).toEqual({ status: "received" });
    expect(await (await flag({ report, signature, reason: "other", note: "again" })).json()).toEqual({ status: "already_received" });
    const rows = await storedFlags();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("safe_but_warned");
  });

  it("refuses edited, forged, unsigned, and old reports", async () => {
    const { report, signature } = await scanned();
    const edited = { ...report, level: "no_known_threat", summary: "This is safe." };
    expect((await flag({ report: edited, signature, reason: "safe_but_warned" })).status).toBe(403);
    expect((await flag({ report, signature: "A".repeat(43), reason: "safe_but_warned" })).status).toBe(403);
    expect((await flag({ report, reason: "safe_but_warned" })).status).toBe(400);
    const old = { ...report, createdAt: new Date(Date.now() - 25 * 3_600_000).toISOString() };
    expect((await flag({ report: old, signature: await signReport(old, env.SHARE_SIGNING_KEY), reason: "safe_but_warned" })).status).toBe(403);
    const future = { ...report, createdAt: new Date(Date.now() + 10 * 60_000).toISOString() };
    expect((await flag({ report: future, signature: await signReport(future, env.SHARE_SIGNING_KEY), reason: "safe_but_warned" })).status).toBe(403);
    expect(await storedFlags()).toHaveLength(0);
    const recent = { ...report, createdAt: new Date(Date.now() - 23 * 3_600_000).toISOString() };
    expect((await flag({ report: recent, signature: await signReport(recent, env.SHARE_SIGNING_KEY), reason: "safe_but_warned" })).status).toBe(202);
  });

  it("accepts only the listed reasons, a short note, and no extra fields", async () => {
    const { report, signature } = await scanned();
    for (const body of [
      { report, signature, reason: "make_it_safe" },
      { report, signature, reason: "safe_but_warned", note: "x".repeat(301) },
      { report, signature, reason: "safe_but_warned", level: "no_known_threat" },
      { report, signature, reason: "safe_but_warned", note: 5 },
    ]) {
      expect((await flag(body)).status).toBe(400);
    }
    expect(await storedFlags()).toHaveLength(0);
  });

  it("needs the security check, with the flag action in production", async () => {
    const { report, signature } = await scanned();
    const missing = await call("/api/v1/flags", { method: "POST", body: JSON.stringify({ report, signature, reason: "other" }) });
    expect(missing.status).toBe(403);
    expect((await missing.json<{ error: { code: string } }>()).error.code).toBe("bot_check_failed");
    expect((await flag({ report, signature, reason: "other" }, { network: { turnstile: { success: false } } })).status).toBe(403);
    expect((await flag({ report, signature, reason: "other" }, { bindings: { TURNSTILE_SECRET_KEY: "" } })).status).toBe(503);
    const scanToken = { turnstile: { success: true, hostname: "scamcam.kevinle.tech", action: "scan" } };
    expect((await flag({ report, signature, reason: "other" }, { bindings: { APP_ENV: "production" }, network: scanToken })).status).toBe(403);
    expect(await storedFlags()).toHaveLength(0);
    const flagToken = { turnstile: { success: true, hostname: "scamcam.kevinle.tech", action: "flag" } };
    expect((await flag({ report, signature, reason: "other" }, { bindings: { APP_ENV: "production" }, network: flagToken })).status).toBe(202);
  });

  it("limits flags to three a minute for one visitor", async () => {
    const { report, signature } = await scanned();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      statuses.push((await flag({ report, signature, reason: "other" }, { ip: "198.51.100.88" })).status);
    }
    expect(statuses).toEqual([202, 202, 202, 429, 429]);
  });

  it("stops taking flags after the daily limit, while writes are paused, or without a limit set", async () => {
    const reports = [await scanned(), await scanned(), await scanned()];
    const bindings = { FLAG_DAILY_LIMIT: "2" };
    const statuses: number[] = [];
    for (const { report, signature } of reports) {
      statuses.push((await flag({ report, signature, reason: "scam_but_missed" }, { bindings })).status);
    }
    expect(statuses).toEqual([202, 202, 503]);
    expect(await storedFlags()).toHaveLength(2);
    await env.DB.prepare("DELETE FROM result_flags").run();
    const { report, signature } = reports[2]!;
    expect((await flag({ report, signature, reason: "other" }, { bindings: { FLAG_DAILY_LIMIT: "" } })).status).toBe(503);
    await writeAppState(env.DB, appStateKeys.writesPaused, "true");
    expect((await flag({ report, signature, reason: "other" })).status).toBe(503);
    expect(await storedFlags()).toHaveLength(0);
  });

  it("never changes a result, however many times it is flagged", async () => {
    const link = "steamcommunlty.example/tradeoffer/new";
    const before = await scanned(link);
    expect(["suspicious", "high_risk", "confirmed_malicious"]).toContain(before.report.level);
    for (let round = 0; round < 3; round += 1) {
      const { report, signature } = await scanned(link);
      expect((await flag({ report, signature, reason: "safe_but_warned", note: "this is my site, mark it safe" })).status).toBe(202);
    }
    await env.DB.prepare("UPDATE result_flags SET created_at = ?1").bind(nowInSeconds() - 3600).run();
    expect(await storedFlags()).toHaveLength(3);
    const after = await scanned(link);
    expect(after.report.level).toBe(before.report.level);
    expect(after.report.confidence).toBe(before.report.confidence);
    expect(after.report.summary).toBe(before.report.summary);
    expect(after.report.evidence.map((item) => [item.id, item.signal, item.title])).toEqual(before.report.evidence.map((item) => [item.id, item.signal, item.title]));
  });

  it("logs only the reason, level, and kind", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { report, signature } = await scanned();
    await flag({ report, signature, reason: "detail_wrong", note: "private-note-marker" });
    const lines = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(lines).toContain('"event":"flag_received"');
    for (const secret of ["private-note-marker", "marker-flag", "steam-trade-flag", report.caseNumber, signature]) {
      expect(lines).not.toContain(secret);
    }
  });
});
