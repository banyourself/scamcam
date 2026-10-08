import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildShards, domainListKeepSeconds } from "../src/engine/domain-list.ts";
import { domainListStatements } from "../src/worker/repositories/domain-list-sql.ts";

const root = resolve(import.meta.dirname, "..");
const wranglerBin = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const tables: Record<string, string> = {
  app_state: "SELECT * FROM app_state ORDER BY key",
  domain_lists: "SELECT * FROM domain_lists ORDER BY list",
  domain_list_shards: "SELECT list, shard, version, entries, hex(hashes) AS hashes, expires_at FROM domain_list_shards ORDER BY list, shard",
  error_events: "SELECT * FROM error_events ORDER BY id",
  maintenance_runs: "SELECT * FROM maintenance_runs ORDER BY id",
  provider_usage: "SELECT * FROM provider_usage ORDER BY provider, day",
  shared_reports: "SELECT id, hex(iv) AS iv, hex(ciphertext) AS ciphertext, created_at, expires_at FROM shared_reports ORDER BY id",
  result_flags: "SELECT * FROM result_flags ORDER BY id",
  scan_totals: "SELECT * FROM scan_totals ORDER BY day, kind, level",
  site_data: "SELECT * FROM site_data ORDER BY dataset",
  site_data_parts: "SELECT dataset, version, part, body FROM site_data_parts ORDER BY dataset, version, part",
  d1_migrations: "SELECT name FROM d1_migrations ORDER BY id",
};
const syntheticNames = 20_000;

function wrangler(directory: string, args: string[]): string {
  return execFileSync(process.execPath, [wranglerBin, ...args], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

function workspace(base: string, name: string): string {
  const directory = join(base, name);
  cpSync(join(root, "wrangler.jsonc"), join(directory, "wrangler.jsonc"));
  cpSync(join(root, "migrations"), join(directory, "migrations"), { recursive: true });
  return directory;
}

function snapshot(directory: string): Record<string, { rows: number; digest: string }> {
  const result: Record<string, { rows: number; digest: string }> = {};
  for (const [table, query] of Object.entries(tables)) {
    const output = wrangler(directory, ["d1", "execute", "scamcam", "--local", "--json", "--command", query]);
    const parsed = JSON.parse(output) as { results: unknown[] }[];
    const rows = parsed[0]?.results ?? [];
    result[table] = { rows: rows.length, digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 16) };
  }
  return result;
}

async function seed(directory: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const day = new Date().toISOString().slice(0, 10);
  const later = now + 35 * 86_400;
  const names = Array.from({ length: syntheticNames }, (_, index) => `drill-${index}.example`);
  const statements = [
    `INSERT INTO app_state (key, value, updated_at) VALUES ('writes_paused', 'false', ${now});`,
    `INSERT INTO provider_usage (provider, day, calls, expires_at) VALUES ('safe_browsing', '${day}', 42, ${later}), ('urlhaus', '${day}', 17, ${later}), ('workers_ai', '${day}', 5, ${later}), ('phishstats', '${day}', 3, ${later});`,
    `INSERT INTO maintenance_runs (task, status, detail_json, started_at, finished_at, expires_at) VALUES ('daily', 'succeeded', '{"alerts":[]}', ${now - 60}, ${now}, ${later});`,
    `INSERT INTO error_events (code, route, created_at, expires_at) VALUES ('TypeError', '/api/v1/scans', ${now}, ${now + 7 * 86_400});`,
    `INSERT INTO shared_reports (id, iv, ciphertext, created_at, expires_at) VALUES ('drill-share-0000000000', X'000102030405060708090a0b', X'deadbeefcafe', ${now}, ${now + 600});`,
    `INSERT INTO result_flags (id, report_key, case_number, kind, level, subject, evidence, reason, note, created_at, expires_at) VALUES ('drill-flag-00000000000', '0123456789abcdef0123456789abcdef', 'SC-000000-0000', 'url', 'suspicious', 'drill.example', 'brand-mismatch-drill.example', 'safe_but_warned', 'drill note', ${now}, ${now + 30 * 86_400});`,
    `INSERT INTO scan_totals (day, kind, level, count, expires_at) VALUES ('2026-01-01', 'url', 'suspicious', 3, ${now + 90 * 86_400});`,
    `INSERT INTO site_data (dataset, version, parts, bytes, built_at) VALUES ('site-security', '0123456789abcdef', 2, 12, ${now});`,
    `INSERT INTO site_data_parts (dataset, version, part, body) VALUES ('site-security', '0123456789abcdef', 0, 'H4sIAAAA'), ('site-security', '0123456789abcdef', 1, 'AAAAAAAA');`,
    ...domainListStatements({
      list: "phishing_database",
      version: "drill-1",
      syncedAt: now,
      expiresAt: now + domainListKeepSeconds,
      shards: await buildShards(names),
    }),
    ...domainListStatements({
      list: "metamask",
      version: "drill-2",
      syncedAt: now,
      expiresAt: now + domainListKeepSeconds,
      shards: await buildShards(names.slice(0, 2000)),
    }),
  ];
  const file = join(directory, "seed.sql");
  writeFileSync(file, `${statements.join("\n")}\n`);
  wrangler(directory, ["d1", "execute", "scamcam", "--local", "--file", file, "--yes"]);
}

function timed<T>(run: () => T): [T, number] {
  const started = performance.now();
  const value = run();
  return [value, Math.round(performance.now() - started)];
}

async function main(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), "scamcam-drill-"));
  try {
    const source = workspace(base, "source");
    const restored = workspace(base, "restored");
    wrangler(source, ["d1", "migrations", "apply", "scamcam", "--local"]);
    await seed(source);
    const before = snapshot(source);

    const backup = join(base, "backup.sql");
    const [, exportMs] = timed(() => wrangler(source, ["d1", "export", "scamcam", "--local", "--output", backup, "-y"]));
    const [, restoreMs] = timed(() => wrangler(restored, ["d1", "execute", "scamcam", "--local", "--file", backup, "--yes"]));
    const after = snapshot(restored);
    const pending = wrangler(restored, ["d1", "migrations", "list", "scamcam", "--local"]);

    const failures: string[] = [];
    for (const table of Object.keys(tables)) {
      const was = before[table]!;
      const now = after[table]!;
      const same = was.rows === now.rows && was.digest === now.digest;
      console.log(`${same ? "pass" : "FAIL"}  ${table}: ${was.rows} row(s) before, ${now.rows} after`);
      if (!same) {
        failures.push(`${table} differs after the restore`);
      }
    }
    if (before.d1_migrations!.rows !== readdirSync(join(root, "migrations")).filter((name) => name.endsWith(".sql")).length) {
      failures.push("the source database is missing migrations");
    }
    if (!/No migrations to apply/i.test(pending)) {
      failures.push("the restored database still lists migrations to apply");
    }
    console.log(`\nexport ${exportMs} ms (${Math.round(statSync(backup).size / 1024)} KB), restore ${restoreMs} ms, ${syntheticNames} list entries`);
    if (failures.length > 0) {
      console.error(`\n${failures.join("\n")}`);
      process.exitCode = 1;
    } else {
      console.log("Backup and restore round trip matched on every table, and no migrations are pending after the restore.");
    }
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

await main();
