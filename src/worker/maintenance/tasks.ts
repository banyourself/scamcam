import { domainListDetails, listNames } from "../../engine/domain-list";
import type { BudgetedProvider } from "../../engine/scan";
import { appStateKeys, writeAppState } from "../repositories/app-state";
import { errorCountsSince } from "../repositories/error-events";
import {
  countRows,
  countRowsMissingExpiry,
  databaseSizeBytes,
  deleteExpiredRows,
  failedRunsSince,
  finishMaintenanceRun,
  retentionTables,
  staleRunningTasks,
  startMaintenanceRun,
  type MaintenanceTask,
} from "../repositories/maintenance";
import { budgetedProviders, dailyLimit, providerUsageSince, usageDay } from "../repositories/provider-usage";
import type { AppBindings } from "../env";
import { domainListStatuses } from "../repositories/domain-lists";
import { waitingFlags } from "../repositories/result-flags";
import { logEvent } from "../logging";
import { cleanupMaxBatchesPerRun, nowInSeconds } from "../retention";

export const cronSchedule = {
  daily: "17 3 * * *",
  weekly: "41 4 * * 1",
  shares: "*/5 * * * *",
} as const;

export const alertThresholds = {
  capacityShare: 0.8,
  weeklyErrors: 50,
  stuckRunSeconds: 6 * 60 * 60,
  listSyncLateSeconds: 2 * 24 * 60 * 60,
} as const;

const daySeconds = 24 * 60 * 60;

interface StorageCheck {
  sizeBytes: number | null;
  softLimitBytes: number;
  writesPaused: boolean;
}

interface UsageSummary {
  calls: number;
  peakDay: number;
  dailyLimit: number | null;
  peakShare: number | null;
}

export interface MaintenanceReport extends Record<string, unknown> {
  alerts: string[];
}

export function taskForCron(cron: string): MaintenanceTask | null {
  if (cron === cronSchedule.daily) {
    return "daily";
  }
  if (cron === cronSchedule.weekly) {
    return "weekly";
  }
  return null;
}

async function checkStorage(env: AppBindings): Promise<StorageCheck> {
  const sizeBytes = await databaseSizeBytes(env.DB);
  const softLimit = Number(env.STORAGE_SOFT_LIMIT_BYTES);
  const overLimit = sizeBytes !== null && Number.isFinite(softLimit) && sizeBytes >= softLimit;
  await writeAppState(env.DB, appStateKeys.writesPaused, overLimit ? "true" : "false");
  return { sizeBytes, softLimitBytes: softLimit, writesPaused: overLimit };
}

async function usageSummary(env: AppBindings, days: number): Promise<Record<BudgetedProvider, UsageSummary>> {
  const rows = await providerUsageSince(env.DB, usageDay(new Date(Date.now() - (days - 1) * daySeconds * 1000)));
  const entries = budgetedProviders.map((provider): [BudgetedProvider, UsageSummary] => {
    const calls = rows.filter((row) => row.provider === provider).map((row) => row.calls);
    const peakDay = Math.max(0, ...calls);
    const limit = dailyLimit(env, provider);
    return [
      provider,
      {
        calls: calls.reduce((total, value) => total + value, 0),
        peakDay,
        dailyLimit: limit,
        peakShare: limit ? Math.round((peakDay / limit) * 100) / 100 : null,
      },
    ];
  });
  return Object.fromEntries(entries) as Record<BudgetedProvider, UsageSummary>;
}

function storageAlerts(storage: StorageCheck): string[] {
  if (storage.writesPaused) {
    return ["storage_over_soft_limit"];
  }
  if (storage.sizeBytes !== null && storage.sizeBytes >= storage.softLimitBytes * alertThresholds.capacityShare) {
    return ["storage_near_soft_limit"];
  }
  return [];
}

function usageAlerts(usage: Record<BudgetedProvider, UsageSummary>): string[] {
  return budgetedProviders.filter((provider) => (usage[provider].peakShare ?? 0) >= alertThresholds.capacityShare).map((provider) => `${provider}_near_daily_limit`);
}

function runAlerts(failedRuns: number, stuckRuns: number): string[] {
  return [...(failedRuns > 0 ? ["maintenance_failed"] : []), ...(stuckRuns > 0 ? ["maintenance_stuck"] : [])];
}

export async function runDailyMaintenance(env: AppBindings): Promise<MaintenanceReport> {
  const deleted: Record<string, number> = {};
  const backlog: string[] = [];
  let batchesUsed = 0;
  for (const [index, table] of retentionTables.entries()) {
    const laterTables = retentionTables.length - index - 1;
    const result = await deleteExpiredRows(env.DB, table, Math.max(1, cleanupMaxBatchesPerRun - batchesUsed - laterTables));
    deleted[table] = result.deleted;
    batchesUsed += result.batches;
    if (!result.finished) {
      backlog.push(`cleanup_backlog_${table}`);
    }
  }
  const storage = await checkStorage(env);
  const stuckRuns = await staleRunningTasks(env.DB, alertThresholds.stuckRunSeconds);
  const failedRuns = await failedRunsSince(env.DB, nowInSeconds() - daySeconds);
  const usage = await usageSummary(env, 2);
  const alerts = [...storageAlerts(storage), ...usageAlerts(usage), ...runAlerts(failedRuns, stuckRuns), ...backlog];
  return { deleted, storage, stuckRuns, failedRuns, usage, alerts };
}

export async function runWeeklyMaintenance(env: AppBindings): Promise<MaintenanceReport> {
  const rows: Record<string, number> = {};
  const missingExpiry: Record<string, number> = {};
  for (const table of retentionTables) {
    rows[table] = await countRows(env.DB, table);
    missingExpiry[table] = await countRowsMissingExpiry(env.DB, table);
  }
  const storage = await checkStorage(env);
  const weekAgo = nowInSeconds() - 7 * daySeconds;
  const usage = await usageSummary(env, 7);
  const errors = await errorCountsSince(env.DB, weekAgo);
  const errorTotal = Object.values(errors).reduce((total, count) => total + count, 0);
  const failedRuns = await failedRunsSince(env.DB, weekAgo);
  const stuckRuns = await staleRunningTasks(env.DB, alertThresholds.stuckRunSeconds);
  const statuses = await domainListStatuses(env.DB);
  const checkedAt = nowInSeconds();
  const lists: Record<string, { version: string; entries: number; ageHours: number; refreshedHoursAgo: number } | null> = Object.fromEntries(
    listNames.map((name) => {
      const status = statuses.get(name);
      return [
        name,
        status
          ? {
              version: status.version,
              entries: status.entries,
              ageHours: Math.floor((checkedAt - status.syncedAt) / 3600),
              refreshedHoursAgo: Math.floor((checkedAt - status.refreshedAt) / 3600),
            }
          : null,
      ];
    }),
  );
  const staleLists = listNames.filter((name) => {
    const status = statuses.get(name);
    return status !== undefined && checkedAt - status.syncedAt > domainListDetails[name].alertAfterDays * 86_400;
  });
  const missingLists = listNames.filter((name) => !statuses.has(name));
  const lateLists = [...statuses.values()].filter((status) => checkedAt - status.refreshedAt > alertThresholds.listSyncLateSeconds);
  const flags = await waitingFlags(env.DB, checkedAt);
  const alerts = [
    ...storageAlerts(storage),
    ...usageAlerts(usage),
    ...runAlerts(failedRuns, stuckRuns),
    ...(errorTotal >= alertThresholds.weeklyErrors ? ["errors_high"] : []),
    ...staleLists.map((name) => (name === "phishing_database" ? "phishing_list_stale" : `${name}_list_stale`)),
    ...(missingLists.length > 0 ? ["scam_list_missing"] : []),
    ...(lateLists.length > 0 ? ["scam_list_sync_late"] : []),
    ...(Object.values(missingExpiry).some((count) => count > 0) ? ["rows_missing_expiry"] : []),
    ...(flags > 0 ? ["flags_waiting"] : []),
  ];
  return {
    rows,
    missingExpiry,
    storage,
    usage,
    errors: { total: errorTotal, byCode: errors },
    runs: { failed: failedRuns, stuck: stuckRuns },
    lists,
    flags: { waiting: flags },
    alerts,
  };
}

export async function runMaintenance(task: MaintenanceTask, env: AppBindings): Promise<void> {
  const runId = await startMaintenanceRun(env.DB, task);
  try {
    const detail = task === "daily" ? await runDailyMaintenance(env) : await runWeeklyMaintenance(env);
    await finishMaintenanceRun(env.DB, runId, "succeeded", detail);
    logEvent("maintenance", { task, status: "succeeded", detail });
    for (const alert of detail.alerts) {
      logEvent("alert", { task, alert });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    await finishMaintenanceRun(env.DB, runId, "failed", { reason });
    logEvent("maintenance", { task, status: "failed", reason });
    logEvent("alert", { task, alert: "maintenance_failed", reason });
    throw error;
  }
}
