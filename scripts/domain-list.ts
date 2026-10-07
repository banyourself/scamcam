import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildShards, domainListKeepSeconds, listNames, normalizerFor, type ListName } from "../src/engine/domain-list.ts";
import { domainListStatements } from "../src/worker/repositories/domain-list-sql.ts";

const formats = ["text", "json-array", "metamask", "scamsniffer-addresses"] as const;

type ListFormat = (typeof formats)[number];

function isListName(value: string): value is ListName {
  return (listNames as readonly string[]).includes(value);
}

function isFormat(value: string): value is ListFormat {
  return (formats as readonly string[]).includes(value);
}

function entriesOf(raw: string, format: ListFormat): string[] {
  if (format === "text") {
    return raw.split(/\r?\n/);
  }
  const parsed: unknown = JSON.parse(raw);
  const list =
    format === "metamask"
      ? (parsed as { blacklist?: unknown } | null)?.blacklist
      : format === "scamsniffer-addresses"
        ? (parsed as { address?: unknown } | null)?.address
        : parsed;
  if (!Array.isArray(list)) {
    throw new TypeError(`The ${format} input does not contain a list of entries`);
  }
  return list.filter((entry): entry is string => typeof entry === "string");
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      list: { type: "string", default: "phishing_database" },
      format: { type: "string", default: "text" },
      out: { type: "string" },
      version: { type: "string" },
      "synced-at": { type: "string" },
      "min-entries": { type: "string", default: "100000" },
      "max-entries": { type: "string", default: "5000000" },
    },
  });
  const { input, out, list, format } = values;
  if (!input || !out || !isListName(list) || !isFormat(format)) {
    console.error(
      `Usage: node scripts/domain-list.ts --input <file> --out <list.sql> [--list ${listNames.join("|")}] [--format ${formats.join("|")}] [--version <id>] [--synced-at <unix seconds>] [--min-entries <n>] [--max-entries <n>]`,
    );
    return 2;
  }

  const syncedAt = values["synced-at"] ? Number(values["synced-at"]) : Math.floor(Date.now() / 1000);
  const version = values.version ?? `local-${syncedAt}`;
  const minEntries = Number(values["min-entries"]);
  const maxEntries = Number(values["max-entries"]);
  const lines = entriesOf(readFileSync(input, "utf8"), format);
  const names: string[] = [];
  const normalize = normalizerFor(list);
  let invalid = 0;
  for (const line of lines) {
    const name = normalize(line);
    if (name) {
      names.push(name);
    } else if (line.trim() !== "" && !line.trim().startsWith("#")) {
      invalid += 1;
    }
  }
  const unique = new Set(names).size;
  if (unique < minEntries) {
    console.error(`Only ${unique} valid entries, fewer than the minimum of ${minEntries}. The download may be incomplete, so nothing was written.`);
    return 1;
  }
  if (unique > maxEntries) {
    console.error(`${unique} valid entries is more than the maximum of ${maxEntries}. This may not be the expected list, so nothing was written.`);
    return 1;
  }

  const shards = await buildShards(names);
  const statements = domainListStatements({
    list,
    version,
    syncedAt,
    expiresAt: Math.max(syncedAt, Math.floor(Date.now() / 1000)) + domainListKeepSeconds,
    shards,
  });
  const sql = `${statements.join("\n")}\n`;
  writeFileSync(out, sql);
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
      list,
    }),
  );
  return 0;
}

process.exitCode = await main();
