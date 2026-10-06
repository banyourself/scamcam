import { z } from "zod";
import { riskLevels, type ScanReport } from "./report";

export const RiskLevelSchema = z.enum(riskLevels);

export const EvidenceSchema = z.object({
  id: z.string(),
  signal: z.enum(["raises_risk", "lowers_risk", "neutral"]),
  title: z.string(),
  detail: z.string(),
  source: z.object({ name: z.string(), url: z.url({ protocol: /^https$/ }).optional() }),
  checkedAt: z.iso.datetime(),
});

export const UncheckedSourceSchema = z.object({
  name: z.string(),
  reason: z.enum(["unavailable", "over_budget", "not_applicable", "skipped", "not_configured", "out_of_date"]),
});

export const ScanReportSchema = z.object({
  caseNumber: z.string(),
  createdAt: z.iso.datetime(),
  subject: z.object({
    kind: z.enum(["url", "message"]),
    display: z.string(),
    registrableDomain: z.string().optional(),
  }),
  level: RiskLevelSchema,
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string(),
  evidence: z.array(EvidenceSchema),
  notChecked: z.array(UncheckedSourceSchema),
  recommendations: z.array(z.string()),
  usesGoogleSafeBrowsing: z.boolean(),
}) satisfies z.ZodType<ScanReport>;
