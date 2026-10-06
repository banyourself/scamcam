import { nowInSeconds } from "../retention";

const cleanupBatch = 500;
const cleanupBatches = 10;

export async function storeShare(db: D1Database, id: string, iv: Uint8Array, ciphertext: Uint8Array, expiresAt: number): Promise<void> {
  await db
    .prepare("INSERT INTO shared_reports (id, iv, ciphertext, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(id, iv, ciphertext, nowInSeconds(), expiresAt)
    .run();
}

function bytes(value: unknown): Uint8Array | null {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value);
  }
  return null;
}

export async function readShare(db: D1Database, id: string, now = nowInSeconds()): Promise<{ iv: Uint8Array; ciphertext: Uint8Array; expiresAt: number } | null> {
  const row = await db
    .prepare("SELECT iv, ciphertext, expires_at FROM shared_reports WHERE id = ?1 AND expires_at > ?2")
    .bind(id, now)
    .first<{ iv: unknown; ciphertext: unknown; expires_at: number }>();
  const iv = bytes(row?.iv);
  const ciphertext = bytes(row?.ciphertext);
  return row && iv && ciphertext ? { iv, ciphertext, expiresAt: row.expires_at } : null;
}

export async function activeShares(db: D1Database, now = nowInSeconds()): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS total FROM shared_reports WHERE expires_at > ?1").bind(now).first<{ total: number }>();
  return row?.total ?? 0;
}

export async function deleteExpiredShares(db: D1Database, now = nowInSeconds()): Promise<number> {
  const statement = db
    .prepare("DELETE FROM shared_reports WHERE rowid IN (SELECT rowid FROM shared_reports WHERE expires_at <= ?1 LIMIT ?2)")
    .bind(now, cleanupBatch);
  let deleted = 0;
  for (let batch = 0; batch < cleanupBatches; batch += 1) {
    const changes = (await statement.run()).meta.changes ?? 0;
    deleted += changes;
    if (changes < cleanupBatch) {
      break;
    }
  }
  return deleted;
}
