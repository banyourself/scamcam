import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { aiEvalCases, type AiEvalCase } from "../test/fixtures/ai-eval-cases.ts";
import { aiHoldoutCases } from "../test/fixtures/ai-holdout-cases.ts";

interface Report {
  level: string;
  evidence: { source: { name: string }; title: string }[];
  notChecked: { name: string; reason: string }[];
}

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:5173" },
    set: { type: "string", default: "dev" },
    details: { type: "string" },
  },
});
const cases: AiEvalCase[] = values.set === "holdout" ? aiHoldoutCases : aiEvalCases;
const flaggedLevels = new Set(["suspicious", "high_risk", "confirmed_malicious"]);
const aiSource = "AI pattern check (Workers AI)";

async function scan(text: string, index: number, attempt = 0): Promise<{ report: Report; ms: number }> {
  const started = performance.now();
  const response = await fetch(`${values.base}/api/v1/scans`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `198.51.100.${(index % 250) + 1}` },
    body: JSON.stringify({ content: text, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" }),
  });
  if (response.status === 429 && attempt < 3) {
    await sleep(61_000);
    return scan(text, index, attempt + 1);
  }
  if (!response.ok) {
    throw new Error(`Scan failed with ${response.status}`);
  }
  return { report: (await response.json()) as Report, ms: performance.now() - started };
}

function percentile(numbers: number[], share: number): number {
  const sorted = [...numbers].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0);
}

const rows: { text: string; scam: boolean; flagged: boolean; by: "rules" | "ai" | null; aiTitle: string | null; aiNote: string | null; ms: number }[] = [];
for (const [index, testCase] of cases.entries()) {
  const { report, ms } = await scan(testCase.text, index);
  const aiEvidence = report.evidence.find((item) => item.source.name === aiSource);
  const aiMissing = report.notChecked.find((item) => item.name === aiSource);
  const flagged = flaggedLevels.has(report.level);
  rows.push({
    text: testCase.text,
    scam: testCase.scam,
    flagged,
    by: flagged ? (aiEvidence ? "ai" : "rules") : null,
    aiTitle: aiEvidence?.title ?? null,
    aiNote: aiMissing?.reason ?? null,
    ms,
  });
  await sleep(250);
}

function rates(flag: (row: (typeof rows)[number]) => boolean) {
  const scams = rows.filter((row) => row.scam);
  const benign = rows.filter((row) => !row.scam);
  const caught = scams.filter(flag).length;
  const falseAlarms = benign.filter(flag).length;
  return {
    recall: Number((caught / scams.length).toFixed(3)),
    falsePositiveRate: Number((falseAlarms / benign.length).toFixed(3)),
    precision: caught + falseAlarms === 0 ? null : Number((caught / (caught + falseAlarms)).toFixed(3)),
    caught,
    scams: scams.length,
    falseAlarms,
    benign: benign.length,
  };
}

if (values.details) {
  writeFileSync(values.details, `${JSON.stringify(rows, null, 2)}\n`);
}
console.log(
  JSON.stringify(
    {
      set: values.set,
      cases: rows.length,
      rulesOnly: rates((row) => row.by === "rules"),
      rulesWithAi: rates((row) => row.flagged),
      aiFlags: rows.filter((row) => row.by === "ai").length,
      aiProblems: rows.filter((row) => row.aiNote).map((row) => row.aiNote),
      latencyMs: { p50: percentile(rows.map((row) => row.ms), 0.5), p95: percentile(rows.map((row) => row.ms), 0.95) },
      falseAlarms: rows.filter((row) => !row.scam && row.flagged).map((row) => `${row.by}: ${row.text}`),
    },
    null,
    2,
  ),
);
