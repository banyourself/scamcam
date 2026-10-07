import { z } from "zod";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";

export const threatfoxEndpoint = "https://threatfox-api.abuse.ch/api/v1/";
export const threatfoxSource = "threatfox";
export const threatfoxHomePage = "https://threatfox.abuse.ch/";
const cacheSeconds = 15 * 60;
const maxResponseBytes = 512 * 1024;

const IocSchema = z.object({
  ioc: z.string(),
  ioc_type: z.string().optional(),
  threat_type: z.string().nullable().optional(),
  malware_printable: z.string().nullable().optional(),
  confidence_level: z.number().nullable().optional(),
});

const ResponseSchema = z.object({ query_status: z.string(), data: z.union([z.array(IocSchema), z.string()]).optional() });

const AnswerSchema = z.union([
  z.object({ status: z.literal("ok"), listed: z.literal(false) }),
  z.object({
    status: z.literal("ok"),
    listed: z.literal(true),
    malware: z.string().nullable(),
    threatType: z.string().nullable(),
    confidence: z.number(),
  }),
]);

type ThreatfoxAnswer = z.infer<typeof AnswerSchema>;

export type ThreatfoxResult = ThreatfoxAnswer | { status: "unavailable" } | { status: "over_budget" };

export interface ThreatfoxOptions {
  authKey: string;
  fetcher: typeof fetch;
  lookups: Lookups;
  takeBudget: () => Promise<boolean>;
}

function isAnswer(value: unknown): value is ThreatfoxAnswer {
  return AnswerSchema.safeParse(value).success;
}

function clean(value: string | null | undefined, length: number): string | null {
  const text = value?.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, length).trim();
  return text ? text : null;
}

async function queryThreatfox(host: string, authKey: string, fetcher: typeof fetch): Promise<ThreatfoxAnswer | null> {
  const timer = deadline(4000);
  try {
    const response = await fetcher(threatfoxEndpoint, {
      method: "POST",
      headers: { "Auth-Key": authKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "search_ioc", search_term: host, exact_match: true }),
      signal: timer.signal,
    });
    if (!response.ok) {
      return null;
    }
    const parsed = ResponseSchema.safeParse(await readLimitedJson(response, maxResponseBytes));
    if (!parsed.success) {
      return null;
    }
    if (parsed.data.query_status === "no_result") {
      return { status: "ok", listed: false };
    }
    const iocs = parsed.data.query_status === "ok" && Array.isArray(parsed.data.data) ? parsed.data.data : null;
    if (!iocs) {
      return null;
    }
    const matching = iocs.filter((ioc) => ioc.ioc.toLowerCase() === host);
    if (matching.length === 0) {
      return { status: "ok", listed: false };
    }
    const best = matching.reduce((top, ioc) => ((ioc.confidence_level ?? 0) > (top.confidence_level ?? 0) ? ioc : top));
    return {
      status: "ok",
      listed: true,
      malware: clean(best.malware_printable, 60),
      threatType: clean(best.threat_type, 40),
      confidence: Math.max(0, Math.min(100, best.confidence_level ?? 50)),
    };
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export async function lookupThreatfoxHost(host: string, options: ThreatfoxOptions): Promise<ThreatfoxResult> {
  const { lookups } = options;
  const key = await cacheKey("threatfox-host", host);
  const hit = await readCached(lookups, key, isAnswer);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<ThreatfoxResult> => {
    if (!sourceIsOpen(lookups, threatfoxSource)) {
      return { status: "unavailable" };
    }
    if (!(await options.takeBudget())) {
      return { status: "over_budget" };
    }
    const answer = await queryThreatfox(host, options.authKey, options.fetcher);
    recordOutcome(lookups, threatfoxSource, answer !== null);
    if (!answer) {
      return { status: "unavailable" };
    }
    await writeCached(lookups, key, answer, cacheSeconds);
    return answer;
  });
}
