import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { flagIdPattern, flagReasonLabels, flagReasons, type FlagReason } from "../src/shared/flags.ts";
import { riskLabels, riskLevels, type RiskLevel } from "../src/shared/report.ts";

const root = resolve(import.meta.dirname, "..");
const wranglerBin = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const maxListed = 50;
const kindNames: Record<string, string> = { url: "link", message: "message", file: "file" };

interface FlagRow {
  id: string;
  case_number: string;
  kind: string;
  level: string;
  subject: string | null;
  evidence: string;
  reason: string;
  note: string | null;
  created_at: number;
}

function d1(sql: string, local: boolean): unknown[] {
  const target = local ? ["--local"] : ["--remote", "--env", "production"];
  const output = execFileSync(process.execPath, [wranglerBin, "d1", "execute", "scamcam", ...target, "--json", "--command", sql], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 16 * 1024 * 1024,
  });
  const parsed = JSON.parse(output.slice(output.indexOf("["))) as { results?: unknown[] }[];
  return parsed[0]?.results ?? [];
}

function printable(value: unknown): string {
  return String(value ?? "").replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu, "?");
}

function reasonLabel(reason: string): string {
  return (flagReasons as readonly string[]).includes(reason) ? flagReasonLabels[reason as FlagReason] : printable(reason);
}

function levelLabel(level: string): string {
  return (riskLevels as readonly string[]).includes(level) ? riskLabels[level as RiskLevel] : printable(level);
}

function main(): number {
  const { values } = parseArgs({ options: { done: { type: "string" }, local: { type: "boolean", default: false } } });
  const local = values.local ?? false;
  if (values.done !== undefined) {
    if (!flagIdPattern.test(values.done)) {
      console.error("A flag id is 22 letters, digits, dashes, or underscores. Copy it from the list.");
      return 2;
    }
    const removed = d1(`DELETE FROM result_flags WHERE id = '${values.done}' RETURNING id`, local);
    console.log(removed.length > 0 ? `Removed flag ${values.done}.` : `No flag has the id ${values.done}.`);
    return removed.length > 0 ? 0 : 1;
  }
  const now = Math.floor(Date.now() / 1000);
  const rows = d1(
    `SELECT id, case_number, kind, level, subject, evidence, reason, note, created_at FROM result_flags WHERE expires_at > ${now} ORDER BY created_at DESC LIMIT ${maxListed}`,
    local,
  ) as FlagRow[];
  if (rows.length === 0) {
    console.log("No flags are waiting for review.");
    return 0;
  }
  for (const row of rows) {
    const when = new Date(row.created_at * 1000).toISOString().slice(0, 16).replace("T", " ");
    console.log(`${printable(row.id)}  ${when} UTC  ${printable(row.case_number)}`);
    console.log(`  Result:   ${levelLabel(row.level)} for a ${kindNames[row.kind] ?? printable(row.kind)}${row.subject ? ` (${printable(row.subject)})` : ""}`);
    console.log(`  Reason:   ${reasonLabel(row.reason)}`);
    console.log(`  Findings: ${printable(row.evidence) || "none"}`);
    if (row.note) {
      console.log(`  Note:     ${printable(row.note)}`);
    }
    console.log("");
  }
  console.log(`${rows.length} flag(s)${rows.length === maxListed ? `, showing the newest ${maxListed}` : ""}. After reviewing one, remove it with: npm run flags -- --done <id>`);
  return 0;
}

process.exitCode = main();
