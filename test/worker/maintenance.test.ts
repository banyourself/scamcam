import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../src/worker/index";
import { cronSchedule, runMaintenance, taskForCron } from "../../src/worker/maintenance/tasks";
import { writesArePaused } from "../../src/worker/repositories/app-state";
import { usageDay } from "../../src/worker/repositories/provider-usage";
import { domainListKeepSeconds, listNames } from "../../src/engine/domain-list";
import { countingDatabase, freePlanSubrequestLimit } from "./counting";
import { nowInSeconds } from "../../src/worker/retention";

async function insertErrorEvent(expiresAt: number) {
  await env.DB.prepare("INSERT INTO error_events (code, route, created_at, expires_at) VALUES ('Error', '/x', ?1, ?2)")
    .bind(nowInSeconds(), expiresAt)
    .run();
}

async function latestRun(task: string) {
  return env.DB.prepare("SELECT status, detail_json FROM maintenance_runs WHERE task = ?1 ORDER BY id DESC")
    .bind(task)
    .first<{ status: string; detail_json: string }>();
}

async function insertUsage(provider: string, daysAgo: number, calls: number) {
  await env.DB.prepare("INSERT INTO provider_usage (provider, day, calls, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(provider, usageDay(new Date(Date.now() - daysAgo * 86_400_000)), calls, nowInSeconds() + 86_400)
    .run();
}

async function insertList(list: string, syncedAt: number, refreshedAt: number) {
  await env.DB.prepare("INSERT INTO domain_lists (list, version, entries, synced_at, expires_at) VALUES (?1, 'v1', 150000, ?2, ?3)")
    .bind(list, syncedAt, refreshedAt + domainListKeepSeconds)
    .run();
}

async function insertFreshLists(except: string[] = []) {
  const now = nowInSeconds();
  for (const list of listNames.filter((name) => !except.includes(name))) {
    await insertList(list, now - 3600, now - 3600);
  }
}

async function detailOf(task: string) {
  return JSON.parse((await latestRun(task))?.detail_json ?? "{}");
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM error_events"),
    env.DB.prepare("DELETE FROM maintenance_runs"),
    env.DB.prepare("DELETE FROM provider_usage"),
    env.DB.prepare("DELETE FROM domain_lists"),
    env.DB.prepare("DELETE FROM result_flags"),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("schedules", () => {
  it("maps each cron expression to one task", () => {
    expect(taskForCron(cronSchedule.daily)).toBe("daily");
    expect(taskForCron(cronSchedule.weekly)).toBe("weekly");
    expect(taskForCron("* * * * *")).toBeNull();
  });
});

describe("daily cleanup", () => {
  it("deletes only expired rows and records the run", async () => {
    const now = nowInSeconds();
    await insertErrorEvent(now - 10);
    await insertErrorEvent(now - 5);
    await insertErrorEvent(now + 3600);
    await runMaintenance("daily", env);
    const left = await env.DB.prepare("SELECT COUNT(*) AS total FROM error_events").first<{ total: number }>();
    expect(left?.total).toBe(1);
    const run = await latestRun("daily");
    expect(run?.status).toBe("succeeded");
    const detail = JSON.parse(run?.detail_json ?? "{}");
    expect(detail.deleted.error_events).toBe(2);
    expect(detail.storage.writesPaused).toBe(false);
  });

  it("pauses optional writes when storage passes the soft limit", async () => {
    await runMaintenance("daily", { ...env, STORAGE_SOFT_LIMIT_BYTES: "1" });
    expect(await writesArePaused(env.DB)).toBe(true);
    await runMaintenance("daily", env);
    expect(await writesArePaused(env.DB)).toBe(false);
  });

  it("runs from the scheduled handler", async () => {
    const ctx = createExecutionContext();
    worker.scheduled(createScheduledController({ cron: cronSchedule.daily, scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect((await latestRun("daily"))?.status).toBe("succeeded");
  });

  it("ignores unknown schedules", async () => {
    const ctx = createExecutionContext();
    worker.scheduled(createScheduledController({ cron: "* * * * *", scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await latestRun("daily")).toBeNull();
  });
});

describe("weekly maintenance", () => {
  it("reports table sizes and rows missing an expiry", async () => {
    await insertErrorEvent(nowInSeconds() + 60);
    await runMaintenance("weekly", env);
    const run = await latestRun("weekly");
    expect(run?.status).toBe("succeeded");
    const detail = JSON.parse(run?.detail_json ?? "{}");
    expect(detail.rows.error_events).toBe(1);
    expect(detail.missingExpiry).toEqual({ error_events: 0, maintenance_runs: 0, provider_usage: 0, domain_lists: 0, domain_list_shards: 0, shared_reports: 0, result_flags: 0 });
    expect(detail.lists.phishing_database).toBeNull();
    expect(Object.keys(detail.lists)).toHaveLength(7);
    expect(typeof detail.storage.sizeBytes === "number" || detail.storage.sizeBytes === null).toBe(true);
  });
});

describe("bounded cleanup", () => {
  it("deletes at most 10,000 expired rows per table in one run and finishes the rest the next day", async () => {
    const past = nowInSeconds() - 60;
    await env.DB.prepare(
      "INSERT INTO error_events (code, route, created_at, expires_at) " +
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10250) SELECT 'Error', '/x', ?1, ?1 FROM n",
    )
      .bind(past)
      .run();
    await runMaintenance("daily", env);
    const first = await detailOf("daily");
    expect(first.deleted.error_events).toBe(10_000);
    expect(first.alerts).toContain("cleanup_backlog_error_events");
    await runMaintenance("daily", env);
    const second = await detailOf("daily");
    expect(second.deleted.error_events).toBe(250);
    expect(second.alerts).not.toContain("cleanup_backlog_error_events");
    const left = await env.DB.prepare("SELECT COUNT(*) AS total FROM error_events").first<{ total: number }>();
    expect(left?.total).toBe(0);
  });
});

describe("monitoring and alerts", () => {
  it("compares provider usage with the daily limits and logs capacity alerts", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await insertUsage("safe_browsing", 0, 7000);
    await insertUsage("safe_browsing", 1, 1000);
    await insertUsage("urlhaus", 1, 100);
    await insertUsage("workers_ai", 3, 1990);
    await insertFreshLists();
    await runMaintenance("weekly", env);
    const weekly = await detailOf("weekly");
    expect(weekly.usage.safe_browsing).toEqual({ calls: 8000, peakDay: 7000, dailyLimit: 8000, peakShare: 0.88 });
    expect(weekly.usage.urlhaus).toEqual({ calls: 100, peakDay: 100, dailyLimit: 5000, peakShare: 0.02 });
    expect(weekly.usage.workers_ai.peakDay).toBe(1990);
    expect(weekly.alerts).toEqual(["safe_browsing_near_daily_limit", "workers_ai_near_daily_limit"]);
    await runMaintenance("daily", env);
    expect((await detailOf("daily")).alerts).toEqual(["safe_browsing_near_daily_limit"]);
    const alerts = log.mock.calls.map(([line]) => JSON.parse(String(line))).filter((entry) => entry.event === "alert");
    expect(alerts.map((entry) => `${entry.task}:${entry.alert}`)).toEqual([
      "weekly:safe_browsing_near_daily_limit",
      "weekly:workers_ai_near_daily_limit",
      "daily:safe_browsing_near_daily_limit",
    ]);
  });

  it("reports errors by code, failed runs, and a stale phishing list", async () => {
    const now = nowInSeconds();
    await env.DB.prepare(
      "INSERT INTO error_events (code, route, created_at, expires_at) " +
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 52) SELECT CASE WHEN i <= 40 THEN 'TypeError' ELSE 'RangeError' END, '/api/v1/scans', ?1, ?2 FROM n",
    )
      .bind(now - 3600, now + 86_400)
      .run();
    await env.DB.prepare("INSERT INTO maintenance_runs (task, status, started_at, finished_at, expires_at) VALUES ('daily', 'failed', ?1, ?1, ?2)")
      .bind(now - 86_400 * 2, now + 86_400)
      .run();
    await insertList("phishing_database", now - 4 * 86_400, now - 2 * 3600);
    await insertFreshLists(["phishing_database"]);
    await runMaintenance("weekly", env);
    const weekly = await detailOf("weekly");
    expect(weekly.errors).toEqual({ total: 52, byCode: { TypeError: 40, RangeError: 12 } });
    expect(weekly.runs).toEqual({ failed: 1, stuck: 0 });
    expect(weekly.lists.phishing_database).toEqual({ version: "v1", entries: 150000, ageHours: 96, refreshedHoursAgo: 2 });
    expect(weekly.alerts).toEqual(["maintenance_failed", "errors_high", "phishing_list_stale"]);
  });

  it("warns when a scam list is missing, has stopped syncing, or has not changed upstream for too long", async () => {
    const now = nowInSeconds();
    await insertList("metamask", now - 3 * 86_400, now - 3 * 86_400);
    await insertList("scam_links", now - 200 * 86_400, now - 3600);
    await insertFreshLists(["metamask", "scam_links", "cert_polska"]);
    await runMaintenance("weekly", env);
    const weekly = await detailOf("weekly");
    expect(weekly.lists.cert_polska).toBeNull();
    expect(weekly.lists.metamask.refreshedHoursAgo).toBe(72);
    expect(weekly.alerts).toEqual(["metamask_list_stale", "scam_links_list_stale", "scam_list_missing", "scam_list_sync_late"]);
  });

  it("warns before storage reaches the soft limit", async () => {
    const size = (await env.DB.prepare("SELECT 1").run()).meta.size_after ?? 0;
    await runMaintenance("daily", { ...env, STORAGE_SOFT_LIMIT_BYTES: String(Math.ceil(size / 0.9)) });
    expect((await detailOf("daily")).alerts).toEqual(["storage_near_soft_limit"]);
    await runMaintenance("daily", { ...env, STORAGE_SOFT_LIMIT_BYTES: "1" });
    expect((await detailOf("daily")).alerts).toEqual(["storage_over_soft_limit"]);
    await runMaintenance("daily", env);
    expect((await detailOf("daily")).alerts).toEqual([]);
  });

  it("records a failed run and logs an alert when a step throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const failing = {
      prepare: (sql: string) => {
        if (sql.startsWith("DELETE")) {
          throw new TypeError("simulated database failure");
        }
        return env.DB.prepare(sql);
      },
      batch: env.DB.batch.bind(env.DB),
      exec: env.DB.exec.bind(env.DB),
    } as unknown as D1Database;
    await expect(runMaintenance("daily", { ...env, DB: failing })).rejects.toThrow("simulated database failure");
    const run = await latestRun("daily");
    expect(run?.status).toBe("failed");
    expect(JSON.parse(run?.detail_json ?? "{}")).toEqual({ reason: "TypeError" });
    const lines = log.mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => line.includes('"event":"alert"') && line.includes('"alert":"maintenance_failed"'))).toBe(true);
    expect(lines.join(" ")).not.toContain("simulated database failure");
  });
});

describe("Workers Free plan limits for maintenance", () => {
  it("stays under 50 database queries a run even when every table has a backlog", async () => {
    const past = nowInSeconds() - 60;
    const fill = (sql: string, rows: number) =>
      env.DB.prepare(sql.replace("{rows}", String(rows))).bind(past).run();
    await fill("INSERT INTO error_events (code, route, created_at, expires_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {rows}) SELECT 'Error', '/x', ?1, ?1 FROM n", 9000);
    await fill("INSERT INTO maintenance_runs (task, status, started_at, finished_at, expires_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {rows}) SELECT 'daily', 'succeeded', ?1, ?1, ?1 FROM n", 3000);
    await fill("INSERT INTO provider_usage (provider, day, calls, expires_at) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {rows}) SELECT 'urlhaus', 'old-' || i, 1, ?1 FROM n", 3000);
    await fill("INSERT INTO domain_list_shards (list, shard, version, entries, hashes, expires_at) WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < {rows} - 1) SELECT 'phishing_database', i, 'old', 0, X'', ?1 FROM n", 1024);
    const counter = { queries: 0 };
    await runMaintenance("daily", { ...env, DB: countingDatabase(env.DB, counter) });
    expect(counter.queries).toBeLessThan(freePlanSubrequestLimit);
    const daily = await detailOf("daily");
    expect(daily.deleted).toEqual({ error_events: 9000, maintenance_runs: 1000, provider_usage: 500, domain_lists: 0, domain_list_shards: 500, shared_reports: 0, result_flags: 0 });
    expect(daily.alerts).toEqual(["cleanup_backlog_maintenance_runs", "cleanup_backlog_provider_usage", "cleanup_backlog_domain_list_shards"]);
    const weekly = { queries: 0 };
    await runMaintenance("weekly", { ...env, DB: countingDatabase(env.DB, weekly) });
    expect(weekly.queries).toBeLessThan(freePlanSubrequestLimit);
    await env.DB.batch([env.DB.prepare("DELETE FROM domain_list_shards"), env.DB.prepare("DELETE FROM provider_usage")]);
  });
});

