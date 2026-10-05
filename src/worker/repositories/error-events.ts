import { expiresAfter, nowInSeconds, retentionSeconds } from "../retention";

export async function recordErrorEvent(db: D1Database, code: string, route: string): Promise<void> {
  const now = nowInSeconds();
  await db
    .prepare("INSERT INTO error_events (code, route, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(code.slice(0, 64), route.slice(0, 128), now, expiresAfter(retentionSeconds.errorEvent, now))
    .run();
}
