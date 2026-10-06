import { recallFromMemory, rememberInMemory, type Lookups } from "../../engine/cache";
import {
  domainListKey,
  domainListStaleAfterSeconds,
  shardContains,
  shardOf,
  type DomainListLookup,
  type DomainListName,
  type DomainListResult,
} from "../../engine/domain-list";
import { nowInSeconds } from "../retention";

const shardMemorySeconds = 600;
const maxNamesPerLookup = 60;

function toBytes(value: unknown): Uint8Array | null {
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

export function d1DomainList(db: D1Database, list: DomainListName, lookups: Lookups, now: () => number = nowInSeconds): DomainListLookup {
  return {
    async lookup(names: string[]): Promise<DomainListResult> {
      const checked = [...new Set(names)].slice(0, maxNamesPerLookup);
      try {
        const meta = await db
          .prepare("SELECT version, synced_at FROM domain_lists WHERE list = ?1")
          .bind(list)
          .first<{ version: string; synced_at: number }>();
        if (!meta) {
          return { status: "not_configured" };
        }
        if (now() - meta.synced_at > domainListStaleAfterSeconds) {
          return { status: "stale" };
        }
        const keys = await Promise.all(checked.map(domainListKey));
        const shards = new Map<number, Uint8Array>();
        const missing: number[] = [];
        for (const shard of new Set(keys.map(shardOf))) {
          const remembered = recallFromMemory(lookups, `list:${list}:${meta.version}:${shard}`);
          if (remembered instanceof Uint8Array) {
            shards.set(shard, remembered);
          } else {
            missing.push(shard);
          }
        }
        if (missing.length > 0) {
          const placeholders = missing.map((_, index) => `?${index + 2}`).join(", ");
          const rows = await db
            .prepare(`SELECT shard, version, hashes FROM domain_list_shards WHERE list = ?1 AND shard IN (${placeholders})`)
            .bind(list, ...missing)
            .all<{ shard: number; version: string; hashes: unknown }>();
          for (const row of rows.results) {
            const bytes = toBytes(row.hashes);
            if (!bytes || bytes.length % 8 !== 0) {
              continue;
            }
            shards.set(row.shard, bytes);
            if (row.version === meta.version) {
              rememberInMemory(lookups, `list:${list}:${meta.version}:${row.shard}`, bytes, shardMemorySeconds);
            }
          }
        }
        const listed = new Set(
          checked.filter((_, index) => {
            const key = keys[index]!;
            const shard = shards.get(shardOf(key));
            return shard ? shardContains(shard, key) : false;
          }),
        );
        return { status: "ok", listed, syncedAt: meta.synced_at };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

export async function domainListStatus(db: D1Database, list: DomainListName): Promise<{ version: string; entries: number; syncedAt: number } | null> {
  const row = await db
    .prepare("SELECT version, entries, synced_at FROM domain_lists WHERE list = ?1")
    .bind(list)
    .first<{ version: string; entries: number; synced_at: number }>();
  return row ? { version: row.version, entries: row.entries, syncedAt: row.synced_at } : null;
}
