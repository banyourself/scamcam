import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { memoryLookupCache } from "../../src/engine/cache";
import { fromBase64Url } from "../../src/shared/base64url";
import type { ScanReport } from "../../src/shared/report";
import { reportSignatureHeader, type SharedReport } from "../../src/shared/share";
import { createApp } from "../../src/worker/app";
import worker from "../../src/worker/index";
import { cronSchedule } from "../../src/worker/maintenance/tasks";
import { signReport } from "../../src/worker/security/report-signature";
import { fakeNetwork } from "../engine/fake-network";

const origin = "https://scamcam.kevinle.tech";
const message = "hey its marker-share-qz9 from the club, you won a skin, log in at steam-trade-share.example/login to claim";
let nextAddress = 1;

async function call(path: string, init: RequestInit = {}, bindings: Partial<typeof env> = {}) {
  const app = createApp({ fetcher: fakeNetwork().fetcher, lookupCache: memoryLookupCache() });
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

async function share(body: unknown, ip?: string) {
  return call("/api/v1/shares", { method: "POST", body: JSON.stringify(body), headers: ip ? { "CF-Connecting-IP": ip } : {} });
}

async function open(id: string, key: string): Promise<SharedReport> {
  const response = await call(`/api/v1/shares/${id}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const stored = await response.json<{ iv: string; ciphertext: string }>();
  const cryptoKey = await crypto.subtle.importKey("raw", fromBase64Url(key)!, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(stored.iv)! }, cryptoKey, fromBase64Url(stored.ciphertext)!);
  return JSON.parse(new TextDecoder().decode(plain)) as SharedReport;
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM shared_reports").run();
});

describe("share links", () => {
  it("shares a signed report for the chosen time, without the message unless asked", async () => {
    const { report, signature } = await scanned();
    expect(report.subject.kind).toBe("message");
    const response = await share({ report, signature, minutes: 10, includeMessage: false });
    expect(response.status).toBe(201);
    const created = await response.json<{ id: string; key: string; expiresAt: string }>();
    expect(created.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(created.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const minutesLeft = (Date.parse(created.expiresAt) - Date.now()) / 60_000;
    expect(minutesLeft).toBeGreaterThan(9.5);
    expect(minutesLeft).toBeLessThanOrEqual(10);
    const opened = await open(created.id, created.key);
    expect(opened.includesMessage).toBe(false);
    expect(opened.report.subject.display).toBe("");
    expect(opened.report.level).toBe(report.level);
    expect(opened.report.evidence).toEqual(report.evidence);

    const withText = await (await share({ report, signature, minutes: 5, includeMessage: true })).json<{ id: string; key: string }>();
    expect((await open(withText.id, withText.key)).report.subject.display).toBe(report.subject.display);
  });

  it("keeps only ciphertext: the database holds neither the message nor the key", async () => {
    const { report, signature } = await scanned();
    const created = await (await share({ report, signature, minutes: 15, includeMessage: true })).json<{ id: string; key: string }>();
    const rows = await env.DB.prepare("SELECT * FROM shared_reports").all<Record<string, unknown>>();
    expect(rows.results).toHaveLength(1);
    const dump = JSON.stringify(rows.results, (_, value: unknown) => (value instanceof ArrayBuffer ? [...new Uint8Array(value)] : value));
    expect(dump).not.toContain("marker-share");
    expect(dump).not.toContain("steam-trade-share");
    expect(dump).not.toContain(created.key);
    const keyBytes = [...fromBase64Url(created.key)!].join(",");
    expect(dump.replaceAll(" ", "")).not.toContain(keyBytes);
  });

  it("refuses edited, forged, unsigned, and old reports", async () => {
    const { report, signature } = await scanned();
    const edited = { ...report, level: "no_known_threat", summary: "This is safe." };
    expect((await share({ report: edited, signature, minutes: 10, includeMessage: false })).status).toBe(403);
    expect((await share({ report, signature: "A".repeat(43), minutes: 10, includeMessage: false })).status).toBe(403);
    expect((await share({ report, minutes: 10, includeMessage: false })).status).toBe(400);
    const old = { ...report, createdAt: new Date(Date.now() - 31 * 60_000).toISOString() };
    const oldSignature = await signReport(old, env.SHARE_SIGNING_KEY);
    expect((await share({ report: old, signature: oldSignature, minutes: 10, includeMessage: false })).status).toBe(403);
    expect((await env.DB.prepare("SELECT COUNT(*) AS total FROM shared_reports").first<{ total: number }>())?.total).toBe(0);
  });

  it("accepts only 5, 10, or 15 minutes and no extra fields", async () => {
    const { report, signature } = await scanned();
    for (const minutes of [0, 1, 7, 16, 60, -5]) {
      expect((await share({ report, signature, minutes, includeMessage: false })).status).toBe(400);
    }
    expect((await share({ report, signature, minutes: 10, includeMessage: false, expiresAt: "2099-01-01" })).status).toBe(400);
  });

  it("answers the same 404 for expired, unknown, and malformed links", async () => {
    const { report, signature } = await scanned();
    const created = await (await share({ report, signature, minutes: 5, includeMessage: false })).json<{ id: string }>();
    await env.DB.prepare("UPDATE shared_reports SET expires_at = 1 WHERE id = ?1").bind(created.id).run();
    const bodies = new Set<string>();
    for (const id of [created.id, "A".repeat(22), "not-a-share", "..%2F..%2Fadmin", "x".repeat(64)]) {
      const response = await call(`/api/v1/shares/${id}`);
      expect(response.status).toBe(404);
      bodies.add(JSON.stringify({ ...(await response.json<{ error: { code: string; message: string } }>()).error, requestId: undefined }));
    }
    expect(bodies.size).toBe(1);
  });

  it("deletes expired shares every five minutes", async () => {
    const { report, signature } = await scanned();
    await share({ report, signature, minutes: 5, includeMessage: false });
    const kept = await (await share({ report, signature, minutes: 15, includeMessage: false })).json<{ id: string }>();
    await env.DB.prepare("UPDATE shared_reports SET expires_at = 1 WHERE id != ?1").bind(kept.id).run();
    const ctx = createExecutionContext();
    worker.scheduled(createScheduledController({ cron: cronSchedule.shares, scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);
    const left = await env.DB.prepare("SELECT id FROM shared_reports").all<{ id: string }>();
    expect(left.results.map((row) => row.id)).toEqual([kept.id]);
  });

  it("limits how many links one visitor can make per minute", async () => {
    const { report, signature } = await scanned();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await share({ report, signature, minutes: 5, includeMessage: false }, "198.51.100.77")).status);
    }
    expect(statuses.filter((status) => status === 201)).toHaveLength(10);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it("offers no signature and refuses to share when no signing key is set", async () => {
    const response = await call("/api/v1/scans", { method: "POST", body: JSON.stringify({ content: message, turnstileToken: "t" }) }, { SHARE_SIGNING_KEY: "" });
    expect(response.status).toBe(200);
    expect(response.headers.get(reportSignatureHeader)).toBeNull();
    const { report, signature } = await scanned();
    expect((await call("/api/v1/shares", { method: "POST", body: JSON.stringify({ report, signature, minutes: 10, includeMessage: false }) }, { SHARE_SIGNING_KEY: "" })).status).toBe(503);
  });
});

describe("share privacy in logs", () => {
  let log: MockInstance;

  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  it("never logs the message, the key, or the share id", async () => {
    const { report, signature } = await scanned();
    const created = await (await share({ report, signature, minutes: 10, includeMessage: true })).json<{ id: string; key: string }>();
    await open(created.id, created.key);
    const lines = log.mock.calls.map(([line]) => String(line)).join("\n");
    expect(lines).toContain('"event":"share_created"');
    for (const secret of ["marker-share", created.key, created.id]) {
      expect(lines).not.toContain(secret);
    }
  });
});
