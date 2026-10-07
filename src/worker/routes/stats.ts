import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { ApiErrorSchema, StatsResponseSchema, type StatsSummary } from "../../shared/api";
import { riskLevels, type ScanReport } from "../../shared/report";
import type { AppEnv } from "../env";
import { countScan, readTotals, totalKinds, utcDay, type TotalRow } from "../repositories/scan-totals";
import { nowInSeconds } from "../retention";

const flaggedLevels = new Set(["suspicious", "high_risk", "confirmed_malicious"]);

export function countInBackground(c: Context<AppEnv>, report: ScanReport): void {
  const task = countScan(c.env.DB, report.subject.kind, report.level).catch(() => undefined);
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    void task;
  }
}

function summarize(rows: TotalRow[], sinceDay: string): StatsSummary {
  const byLevel = Object.fromEntries(riskLevels.map((level) => [level, 0])) as StatsSummary["byLevel"];
  const byKind = Object.fromEntries(totalKinds.map((kind) => [kind, 0])) as StatsSummary["byKind"];
  let checks = 0;
  let flagged = 0;
  for (const row of rows) {
    if (row.day < sinceDay || !(row.level in byLevel)) {
      continue;
    }
    checks += row.count;
    byLevel[row.level as keyof StatsSummary["byLevel"]] += row.count;
    byKind[row.kind] += row.count;
    if (flaggedLevels.has(row.level)) {
      flagged += row.count;
    }
  }
  return { since: sinceDay, checks, flagged, byLevel, byKind };
}

const statsRoute = createRoute({
  method: "get",
  path: "/stats",
  summary: "Anonymous totals of checks and results",
  description: "Daily counts by input kind and result level only. Nothing anyone checked is stored.",
  responses: {
    200: { description: "Totals for the last 7 and 30 days", content: { "application/json": { schema: StatsResponseSchema } } },
    429: { description: "Too many requests", content: { "application/json": { schema: ApiErrorSchema } } },
  },
});

export const statsRoutes = new OpenAPIHono<AppEnv>().openapi(statsRoute, async (c) => {
  const now = nowInSeconds();
  const week = utcDay(now - 6 * 86_400);
  const month = utcDay(now - 29 * 86_400);
  const rows = await readTotals(c.env.DB, month);
  return c.json({ generatedAt: new Date(now * 1000).toISOString(), last7: summarize(rows, week), last30: summarize(rows, month) }, 200);
});
