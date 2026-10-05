import { nowInSeconds } from "../retention";

export const appStateKeys = {
  writesPaused: "writes_paused",
} as const;

type AppStateKey = (typeof appStateKeys)[keyof typeof appStateKeys];

export async function readAppState(db: D1Database, key: AppStateKey): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_state WHERE key = ?1").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function writeAppState(db: D1Database, key: AppStateKey, value: string): Promise<void> {
  await db
    .prepare(
      "INSERT INTO app_state (key, value, updated_at) VALUES (?1, ?2, ?3) " +
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key, value, nowInSeconds())
    .run();
}

export async function writesArePaused(db: D1Database): Promise<boolean> {
  return (await readAppState(db, appStateKeys.writesPaused)) === "true";
}
