import { nowInSeconds } from "../retention";

export interface NewFlag {
  id: string;
  reportKey: string;
  caseNumber: string;
  kind: "url" | "message" | "file";
  level: string;
  subject: string | null;
  evidence: string;
  reason: string;
  note: string | null;
  createdAt: number;
  expiresAt: number;
}

export type FlagOutcome = "stored" | "duplicate" | "over_daily_limit";

export async function storeFlag(db: D1Database, flag: NewFlag, dayStart: number, dailyLimit: number): Promise<FlagOutcome> {
  const inserted = await db
    .prepare(
      "INSERT INTO result_flags (id, report_key, case_number, kind, level, subject, evidence, reason, note, created_at, expires_at) " +
        "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 " +
        "WHERE (SELECT COUNT(*) FROM result_flags WHERE created_at >= ?12) < ?13 " +
        "ON CONFLICT (report_key) DO NOTHING",
    )
    .bind(
      flag.id,
      flag.reportKey,
      flag.caseNumber,
      flag.kind,
      flag.level,
      flag.subject,
      flag.evidence,
      flag.reason,
      flag.note,
      flag.createdAt,
      flag.expiresAt,
      dayStart,
      dailyLimit,
    )
    .run();
  if ((inserted.meta.changes ?? 0) > 0) {
    return "stored";
  }
  const existing = await db.prepare("SELECT 1 AS found FROM result_flags WHERE report_key = ?1").bind(flag.reportKey).first<{ found: number }>();
  return existing ? "duplicate" : "over_daily_limit";
}

export async function waitingFlags(db: D1Database, now = nowInSeconds()): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM result_flags WHERE expires_at > ?1").bind(now).first<{ total: number }>();
  return row?.total ?? 0;
}
