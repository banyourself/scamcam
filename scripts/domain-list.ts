import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildShards, domainListKeepSeconds, normalizeListEntry } from "../src/engine/domain-list.ts";
import { domainListStatements } from "../src/worker/repositories/domain-list-sql.ts";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    out: { type: "string" },
    version: { type: "string" },
    "synced-at": { type: "string" },
    "min-entries": { type: "string", default: "100000" },
    "max-entries": { type: "string", default: "5000000" },
  },
});

if (!values.input || !values.out) {
  console.error("Usage: node scripts/domain-list.ts --input <list.txt> --out <list.sql> [--version <id>] [--synced-at <unix seconds>] [--min-entries <n>] [--max-entries <n>]");
  process.exit(2);
}

const syncedAt = values["synced-at"] ? Number(values["synced-at"]) : Math.floor(Date.now() / 1000);
const version = values.version ?? `local-${syncedAt}`;
const minEntries = Number(values["min-entries"]);
const maxEntries = Number(values["max-entries"]);
const lines = readFileSync(values.input, "utf8").split(/\r?\n/);
const names: string[] = [];
let invalid = 0;
for (const line of lines) {
  const name = normalizeListEntry(line);
  if (name) {
    names.push(name);
  } else if (line.trim() !== "" && !line.trim().startsWith("#")) {
    invalid += 1;
  }
}
const unique = new Set(names).size;
if (unique < minEntries) {
  console.error(`Only ${unique} valid entries, fewer than the minimum of ${minEntries}. The download may be incomplete, so nothing was written.`);
  process.exit(1);
}
if (unique > maxEntries) {
  console.error(`${unique} valid entries is more than the maximum of ${maxEntries}. This may not be the expected list, so nothing was written.`);
  process.exit(1);
}

const shards = await buildShards(names);
const statements = domainListStatements({
  list: "phishing_database",
  version,
  syncedAt,
  expiresAt: syncedAt + domainListKeepSeconds,
  shards,
});
const sql = `${statements.join("\n")}\n`;
writeFileSync(values.out, sql);
console.log(
  JSON.stringify({
    lines: lines.length,
    valid: names.length,
    invalid,
    unique,
    shards: shards.length,
    largestShardBytes: Math.max(...shards.map((shard) => shard.length)),
    sqlBytes: sql.length,
    statements: statements.length,
    version,
    syncedAt,
  }),
);
