import { cleanupBatchSize, expiresAfter, nowInSeconds, retentionSeconds } from "../retention";

export const retentionTables = ["error_events", "maintenance_runs", "provider_usage", "domain_lists", "domain_list_shards", "shared_reports", "result_flags"] as const;
export type RetentionTable = (typeof retentionTables)[number];
export type MaintenanceTask = "daily" | "weekly";

export async function startMaintenanceRun(db: D1Database, task: MaintenanceTask): Promise<number> {
  const now = nowInSeconds();
  const row = await db
    .prepare(
      "INSERT INTO maintenance_runs (task, status, started_at, expires_at) VALUES (?1, 'running', ?2, ?3) RETURNING id",
    )
    .bind(task, now, expiresAfter(retentionSeconds.maintenanceRun, now))
    .first<{ id: number }>();
  if (!row) {
    throw new Error("maintenance_run_not_created");
  }
  return row.id;
}

export async function finishMaintenanceRun(
  db: D1Database,
  id: number,
  status: "succeeded" | "failed",
  detail: Record<string, unknown>,
): Promise<void> {
  await db
    .prepare("UPDATE maintenance_runs SET status = ?1, detail_json = ?2, finished_at = ?3 WHERE id = ?4")
    .bind(status, JSON.stringify(detail), nowInSeconds(), id)
    .run();
}

export async function deleteExpiredRows(
  db: D1Database,
  table: RetentionTable,
  maxBatches: number,
  now = nowInSeconds(),
): Promise<{ deleted: number; batches: number; finished: boolean }> {
  const statement = db
    .prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE expires_at <= ?1 LIMIT ?2)`)
    .bind(now, cleanupBatchSize);
  let deleted = 0;
  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const result = await statement.run();
    const changes = result.meta.changes ?? 0;
    deleted += changes;
    if (changes < cleanupBatchSize) {
      return { deleted, batches: batch, finished: true };
    }
  }
  return { deleted, batches: maxBatches, finished: false };
}

export async function countRows(db: D1Database, table: RetentionTable): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{ total: number }>();
  return row?.total ?? 0;
}

export async function countRowsMissingExpiry(db: D1Database, table: RetentionTable): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE expires_at IS NULL OR expires_at <= 0`)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function databaseSizeBytes(db: D1Database): Promise<number | null> {
  const result = await db.prepare("SELECT 1").run();
  const size = result.meta.size_after;
  return typeof size === "number" ? size : null;
}

export async function staleRunningTasks(db: D1Database, olderThanSeconds: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS total FROM maintenance_runs WHERE status = 'running' AND started_at < ?1")
    .bind(nowInSeconds() - olderThanSeconds)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function failedRunsSince(db: D1Database, since: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS total FROM maintenance_runs WHERE status = 'failed' AND started_at >= ?1")
    .bind(since)
    .first<{ total: number }>();
  return row?.total ?? 0;
}
