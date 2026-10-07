import { nowInSeconds } from "../retention";

export const scanTotalsDays = 90;
export const totalKinds = ["url", "message", "file"] as const;
export type TotalKind = (typeof totalKinds)[number];

export interface TotalRow {
  day: string;
  kind: TotalKind;
  level: string;
  count: number;
}

export function utcDay(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export async function countScan(db: D1Database, kind: TotalKind, level: string, now = nowInSeconds()): Promise<void> {
  await db
    .prepare(
      "INSERT INTO scan_totals (day, kind, level, count, expires_at) VALUES (?1, ?2, ?3, 1, ?4) " +
        "ON CONFLICT (day, kind, level) DO UPDATE SET count = count + 1",
    )
    .bind(utcDay(now), kind, level, now + scanTotalsDays * 86_400)
    .run();
}

export async function readTotals(db: D1Database, sinceDay: string): Promise<TotalRow[]> {
  const result = await db.prepare("SELECT day, kind, level, count FROM scan_totals WHERE day >= ?1").bind(sinceDay).all<TotalRow>();
  return result.results ?? [];
}

export async function deleteExpiredTotals(db: D1Database, now = nowInSeconds()): Promise<number> {
  const result = await db.prepare("DELETE FROM scan_totals WHERE expires_at <= ?1").bind(now).run();
  return result.meta.changes ?? 0;
}
