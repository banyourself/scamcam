import { appStateKeys, writeAppState } from "../repositories/app-state";
import {
  countRows,
  countRowsMissingExpiry,
  databaseSizeBytes,
  deleteExpiredRows,
  finishMaintenanceRun,
  retentionTables,
  staleRunningTasks,
  startMaintenanceRun,
  type MaintenanceTask,
} from "../repositories/maintenance";
import type { AppBindings } from "../env";
import { logEvent } from "../logging";

export const cronSchedule = {
  daily: "17 3 * * *",
  weekly: "41 4 * * 1",
} as const;

export function taskForCron(cron: string): MaintenanceTask | null {
  if (cron === cronSchedule.daily) {
    return "daily";
  }
  if (cron === cronSchedule.weekly) {
    return "weekly";
  }
  return null;
}

async function checkStorage(env: AppBindings): Promise<Record<string, unknown>> {
  const sizeBytes = await databaseSizeBytes(env.DB);
  const softLimit = Number(env.STORAGE_SOFT_LIMIT_BYTES);
  const overLimit = sizeBytes !== null && Number.isFinite(softLimit) && sizeBytes >= softLimit;
  await writeAppState(env.DB, appStateKeys.writesPaused, overLimit ? "true" : "false");
  return { sizeBytes, softLimitBytes: softLimit, writesPaused: overLimit };
}

export async function runDailyMaintenance(env: AppBindings): Promise<Record<string, unknown>> {
  const deleted: Record<string, number> = {};
  for (const table of retentionTables) {
    deleted[table] = await deleteExpiredRows(env.DB, table);
  }
  const storage = await checkStorage(env);
  const stuckRuns = await staleRunningTasks(env.DB, 6 * 60 * 60);
  return { deleted, storage, stuckRuns };
}

export async function runWeeklyMaintenance(env: AppBindings): Promise<Record<string, unknown>> {
  const rows: Record<string, number> = {};
  const missingExpiry: Record<string, number> = {};
  for (const table of retentionTables) {
    rows[table] = await countRows(env.DB, table);
    missingExpiry[table] = await countRowsMissingExpiry(env.DB, table);
  }
  const storage = await checkStorage(env);
  return { rows, missingExpiry, storage };
}

export async function runMaintenance(task: MaintenanceTask, env: AppBindings): Promise<void> {
  const runId = await startMaintenanceRun(env.DB, task);
  try {
    const detail = task === "daily" ? await runDailyMaintenance(env) : await runWeeklyMaintenance(env);
    await finishMaintenanceRun(env.DB, runId, "succeeded", detail);
    logEvent("maintenance", { task, status: "succeeded", detail });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    await finishMaintenanceRun(env.DB, runId, "failed", { reason });
    logEvent("maintenance", { task, status: "failed", reason });
    throw error;
  }
}
