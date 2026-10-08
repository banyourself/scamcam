import { z } from "@hono/zod-openapi";

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    version: z.string(),
    environment: z.string(),
    scanning: z.enum(["available", "not_yet_available", "paused"]),
    turnstileSiteKey: z.string().nullable(),
  })
  .openapi("HealthResponse");

export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
    }),
  })
  .openapi("ApiError");

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

const LevelCountsSchema = z.object({
  no_known_threat: z.number().int(),
  unknown: z.number().int(),
  suspicious: z.number().int(),
  high_risk: z.number().int(),
  confirmed_malicious: z.number().int(),
});

const StatsSummarySchema = z.object({
  since: z.string(),
  checks: z.number().int(),
  flagged: z.number().int(),
  byLevel: LevelCountsSchema,
  byKind: z.object({ url: z.number().int(), message: z.number().int(), file: z.number().int() }),
});

export const StatsResponseSchema = z
  .object({ generatedAt: z.string(), last7: StatsSummarySchema, last30: StatsSummarySchema })
  .openapi("StatsResponse");

export type StatsSummary = z.infer<typeof StatsSummarySchema>;
export type StatsResponse = z.infer<typeof StatsResponseSchema>;

export const breachNotes = ["unverified", "fabricated", "sensitive", "spam_list", "malware", "stealer_log", "retired"] as const;

const BreachEntrySchema = z.object({
  name: z.string(),
  title: z.string(),
  domain: z.string(),
  breachDate: z.string(),
  addedDate: z.string(),
  accounts: z.number().int().nonnegative(),
  classes: z.array(z.number().int().nonnegative()),
  notes: z.array(z.enum(breachNotes)),
});

export const BreachCatalogSchema = z
  .object({ fetchedAt: z.string(), dataClasses: z.array(z.string()), breaches: z.array(BreachEntrySchema) })
  .openapi("BreachCatalog");

export type BreachNote = (typeof breachNotes)[number];
export type BreachEntry = z.infer<typeof BreachEntrySchema>;
export type BreachCatalog = z.infer<typeof BreachCatalogSchema>;
