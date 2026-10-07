import { recallFromMemory, rememberInMemory, type Lookups } from "../../engine/cache";
import {
  domainListDetails,
  domainListKeepSeconds,
  domainListKey,
  domainListNames,
  shardContains,
  shardOf,
  type DomainListLookup,
  type DomainListName,
  type DomainListResults,
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

function isListName(value: string): value is DomainListName {
  return (domainListNames as readonly string[]).includes(value);
}

export function d1DomainLists(db: D1Database, lookups: Lookups, now: () => number = nowInSeconds): DomainListLookup {
  return {
    async lookup(names: string[]): Promise<DomainListResults> {
      const checked = [...new Set(names)].slice(0, maxNamesPerLookup);
      const results: DomainListResults = new Map();
      try {
        const metas = await db.prepare("SELECT list, version, synced_at FROM domain_lists").all<{ list: string; version: string; synced_at: number }>();
        const active: { name: DomainListName; version: string; syncedAt: number }[] = [];
        for (const name of domainListNames) {
          const meta = metas.results.find((row) => row.list === name);
          if (!meta) {
            results.set(name, { status: "not_configured" });
          } else if (now() - meta.synced_at > domainListDetails[name].staleAfterDays * 86_400) {
            results.set(name, { status: "stale" });
          } else {
            active.push({ name, version: meta.version, syncedAt: meta.synced_at });
          }
        }
        if (active.length === 0 || checked.length === 0) {
          for (const list of active) {
            results.set(list.name, { status: "ok", listed: new Set(), syncedAt: list.syncedAt });
          }
          return results;
        }
        const keys = await Promise.all(checked.map(domainListKey));
        const wanted = [...new Set(keys.map(shardOf))];
        const shards = new Map<string, Uint8Array>();
        const missingLists = new Set<DomainListName>();
        const missingShards = new Set<number>();
        for (const list of active) {
          for (const shard of wanted) {
            const remembered = recallFromMemory(lookups, `list:${list.name}:${list.version}:${shard}`);
            if (remembered instanceof Uint8Array) {
              shards.set(`${list.name}:${shard}`, remembered);
            } else {
              missingLists.add(list.name);
              missingShards.add(shard);
            }
          }
        }
        if (missingLists.size > 0) {
          const listNames = [...missingLists];
          const shardNumbers = [...missingShards];
          const listPlaceholders = listNames.map((_, index) => `?${index + 1}`).join(", ");
          const shardPlaceholders = shardNumbers.map((_, index) => `?${index + 1 + listNames.length}`).join(", ");
          const rows = await db
            .prepare(`SELECT list, shard, version, hashes FROM domain_list_shards WHERE list IN (${listPlaceholders}) AND shard IN (${shardPlaceholders})`)
            .bind(...listNames, ...shardNumbers)
            .all<{ list: string; shard: number; version: string; hashes: unknown }>();
          for (const row of rows.results) {
            const bytes = toBytes(row.hashes);
            const list = active.find((entry) => entry.name === row.list);
            if (!bytes || bytes.length % 8 !== 0 || !isListName(row.list) || !list) {
              continue;
            }
            shards.set(`${row.list}:${row.shard}`, bytes);
            if (row.version === list.version) {
              rememberInMemory(lookups, `list:${row.list}:${list.version}:${row.shard}`, bytes, shardMemorySeconds);
            }
          }
        }
        for (const list of active) {
          const listed = new Set(
            checked.filter((_, index) => {
              const key = keys[index]!;
              const shard = shards.get(`${list.name}:${shardOf(key)}`);
              return shard ? shardContains(shard, key) : false;
            }),
          );
          results.set(list.name, { status: "ok", listed, syncedAt: list.syncedAt });
        }
        return results;
      } catch {
        return new Map(domainListNames.map((name) => [name, { status: "unavailable" }]));
      }
    },
  };
}

export interface DomainListStatus {
  version: string;
  entries: number;
  syncedAt: number;
  refreshedAt: number;
}

export async function domainListStatuses(db: D1Database): Promise<Map<DomainListName, DomainListStatus>> {
  const rows = await db
    .prepare("SELECT list, version, entries, synced_at, expires_at FROM domain_lists")
    .all<{ list: string; version: string; entries: number; synced_at: number; expires_at: number }>();
  const statuses = new Map<DomainListName, DomainListStatus>();
  for (const row of rows.results) {
    if (isListName(row.list)) {
      statuses.set(row.list, { version: row.version, entries: row.entries, syncedAt: row.synced_at, refreshedAt: row.expires_at - domainListKeepSeconds });
    }
  }
  return statuses;
}
