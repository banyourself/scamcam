import { expiresAfter, nowInSeconds, retentionSeconds } from "../retention";

export async function recordErrorEvent(db: D1Database, code: string, route: string): Promise<void> {
  const now = nowInSeconds();
  await db
    .prepare("INSERT INTO error_events (code, route, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(code.slice(0, 64), route.slice(0, 128), now, expiresAfter(retentionSeconds.errorEvent, now))
    .run();
}

export async function errorCountsSince(db: D1Database, since: number): Promise<Record<string, number>> {
  const result = await db
    .prepare("SELECT code, COUNT(*) AS total FROM error_events WHERE created_at >= ?1 GROUP BY code ORDER BY total DESC LIMIT 20")
    .bind(since)
    .all<{ code: string; total: number }>();
  return Object.fromEntries(result.results.map((row) => [row.code, row.total]));
}
