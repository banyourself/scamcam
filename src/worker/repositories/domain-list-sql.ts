import type { DomainListName } from "../../engine/domain-list";

export interface DomainListBuild {
  list: DomainListName;
  version: string;
  syncedAt: number;
  expiresAt: number;
  shards: Uint8Array[];
}

export const maxStatementBytes = 100_000;

const versionPattern = /^[A-Za-z0-9._-]{1,64}$/;
const listNamePattern = /^[a-z_]{1,32}$/;

function hex(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    text += byte.toString(16).padStart(2, "0");
  }
  return text;
}

function wholeSeconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a whole number of seconds`);
  }
  return value;
}

export function domainListStatements(build: DomainListBuild): string[] {
  if (!listNamePattern.test(build.list)) {
    throw new RangeError("The list name may contain only lowercase letters and underscores");
  }
  if (!versionPattern.test(build.version)) {
    throw new RangeError("The list version may contain only letters, digits, dots, dashes, and underscores");
  }
  const syncedAt = wholeSeconds(build.syncedAt, "syncedAt");
  const expiresAt = wholeSeconds(build.expiresAt, "expiresAt");
  let total = 0;
  const statements = build.shards.map((shard, index) => {
    const entries = shard.length / 8;
    if (!Number.isInteger(entries)) {
      throw new RangeError(`Shard ${index} is not a whole number of keys`);
    }
    total += entries;
    return (
      "INSERT INTO domain_list_shards (list, shard, version, entries, hashes, expires_at) " +
      `VALUES ('${build.list}', ${index}, '${build.version}', ${entries}, X'${hex(shard)}', ${expiresAt}) ` +
      "ON CONFLICT (list, shard) DO UPDATE SET version = excluded.version, entries = excluded.entries, hashes = excluded.hashes, expires_at = excluded.expires_at;"
    );
  });
  statements.push(
    "INSERT INTO domain_lists (list, version, entries, synced_at, expires_at) " +
      `VALUES ('${build.list}', '${build.version}', ${total}, ${syncedAt}, ${expiresAt}) ` +
      "ON CONFLICT (list) DO UPDATE SET version = excluded.version, entries = excluded.entries, synced_at = excluded.synced_at, expires_at = excluded.expires_at;",
  );
  const tooLong = statements.findIndex((statement) => statement.length > maxStatementBytes);
  if (tooLong >= 0) {
    throw new RangeError(`Statement ${tooLong} is longer than D1 allows`);
  }
  return statements;
}
