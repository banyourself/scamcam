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
    assert.ok(sql.at(-1)!.includes("'fixture-1', 5001, 1000, 605800"));
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
