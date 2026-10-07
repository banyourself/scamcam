import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/domain-list.ts", import.meta.url));

function fixture(count: number): string {
  const lines = ["# Phishing.Database style list", "", "Not A Domain", "Duplicate.Example.", "duplicate.example"];
  for (let index = 0; index < count; index += 1) {
    lines.push(`scam-${index}.example`);
  }
  return lines.join("\n");
}

test("the list builder writes one statement per shard plus the list record", () => {
  const folder = mkdtempSync(join(tmpdir(), "scamcam-list-"));
  try {
    writeFileSync(join(folder, "list.txt"), fixture(5000));
    const output = execFileSync(process.execPath, [script, "--input", join(folder, "list.txt"), "--out", join(folder, "list.sql"), "--version", "fixture-1", "--synced-at", "1000", "--min-entries", "100"], { encoding: "utf8" });
    const summary = JSON.parse(output) as { unique: number; invalid: number; statements: number };
    assert.equal(summary.unique, 5001);
    assert.equal(summary.invalid, 1);
    assert.equal(summary.statements, 1025);
    const sql = readFileSync(join(folder, "list.sql"), "utf8").trim().split("\n");
    assert.equal(sql.length, 1025);
    const expiresAt = Number(/'fixture-1', 5001, 1000, (\d+)\)/.exec(sql.at(-1)!)?.[1]);
    assert.ok(expiresAt >= Math.floor(Date.now() / 1000) + 864_000 - 60, "the copy is kept 10 days from when it was made, not from the list's own date");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("the list builder refuses a list that is far larger than expected", () => {
  const folder = mkdtempSync(join(tmpdir(), "scamcam-list-"));
  try {
    writeFileSync(join(folder, "list.txt"), fixture(300));
    const result = spawnSync(process.execPath, [script, "--input", join(folder, "list.txt"), "--out", join(folder, "list.sql"), "--min-entries", "1", "--max-entries", "100"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /more than the maximum/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("the list builder refuses a list that looks cut off", () => {
  const folder = mkdtempSync(join(tmpdir(), "scamcam-list-"));
  try {
    writeFileSync(join(folder, "list.txt"), fixture(50));
    const result = spawnSync(process.execPath, [script, "--input", join(folder, "list.txt"), "--out", join(folder, "list.sql")], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fewer than the minimum/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("the list builder reads MetaMask's config and JSON lists under their own list names", () => {
  const folder = mkdtempSync(join(tmpdir(), "scamcam-list-"));
  try {
    const domains = Array.from({ length: 120 }, (_, index) => `wallet-${index}.example`);
    writeFileSync(join(folder, "config.json"), JSON.stringify({ version: 2, whitelist: ["metamask.io"], blacklist: [...domains, 42, "Not A Domain"] }));
    const metamask = JSON.parse(
      execFileSync(process.execPath, [script, "--input", join(folder, "config.json"), "--out", join(folder, "metamask.sql"), "--list", "metamask", "--format", "metamask", "--version", "mm-1", "--min-entries", "100"], { encoding: "utf8" }),
    ) as { unique: number; invalid: number; list: string };
    assert.deepEqual([metamask.unique, metamask.invalid, metamask.list], [120, 1, "metamask"]);
    const metamaskSql = readFileSync(join(folder, "metamask.sql"), "utf8");
    assert.match(metamaskSql, /INSERT INTO domain_lists \(list, version, entries, synced_at, expires_at\) VALUES \('metamask', 'mm-1', 120,/);
    assert.doesNotMatch(metamaskSql, /'phishing_database'/);

    writeFileSync(join(folder, "domains.json"), JSON.stringify(domains));
    const scamsniffer = JSON.parse(
      execFileSync(process.execPath, [script, "--input", join(folder, "domains.json"), "--out", join(folder, "scamsniffer.sql"), "--list", "scamsniffer", "--format", "json-array", "--min-entries", "100"], { encoding: "utf8" }),
    ) as { unique: number; list: string };
    assert.deepEqual([scamsniffer.unique, scamsniffer.list], [120, "scamsniffer"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("the list builder refuses an unknown list name or format", () => {
  const folder = mkdtempSync(join(tmpdir(), "scamcam-list-"));
  try {
    writeFileSync(join(folder, "list.txt"), fixture(300));
    for (const extra of [["--list", "everything'; DROP TABLE domain_lists; --"], ["--format", "yaml"]]) {
      const result = spawnSync(process.execPath, [script, "--input", join(folder, "list.txt"), "--out", join(folder, "list.sql"), "--min-entries", "1", ...extra], { encoding: "utf8" });
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Usage:/);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
