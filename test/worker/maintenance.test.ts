import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../../src/worker/index";
import { cronSchedule, runMaintenance, taskForCron } from "../../src/worker/maintenance/tasks";
import { writesArePaused } from "../../src/worker/repositories/app-state";
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

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM error_events"), env.DB.prepare("DELETE FROM maintenance_runs")]);
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
    expect(detail.missingExpiry).toEqual({ error_events: 0, maintenance_runs: 0 });
    expect(typeof detail.storage.sizeBytes === "number" || detail.storage.sizeBytes === null).toBe(true);
  });
});
