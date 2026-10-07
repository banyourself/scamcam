import { z } from "zod";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";

export const radarEndpoint = "https://api.cloudflare.com/client/v4/radar/ranking/domain/";
export const radarHomePage = "https://radar.cloudflare.com/domains";
export const radarLicenseUrl = "https://creativecommons.org/licenses/by-nc/4.0/";
export const radarSource = "radar";
export const radarPopularTop = 100_000;
const cacheSeconds = 24 * 60 * 60;
const maxResponseBytes = 64 * 1024;
const domainPattern = /^(?=.{1,200}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;
const warningCategories = /phish|malware|spam|botnet|command and control|spyware|crypto ?min|parked|newly|dga|security threat|questionable/i;

const ResponseSchema = z.object({
  success: z.boolean(),
  result: z
    .object({
      details_0: z
        .object({
          bucket: z.string().max(32).nullable().optional(),
          rank: z.number().nullable().optional(),
          categories: z.array(z.object({ name: z.string().max(200) })).optional(),
        })
        .optional(),
    })
    .optional(),
});

const AnswerSchema = z.object({ status: z.literal("ok"), top: z.number().int().positive().nullable(), warningCategory: z.boolean() });

export type RadarAnswer = z.infer<typeof AnswerSchema>;
export type RadarResult = RadarAnswer | { status: "unavailable" };

export interface RadarOptions {
  token: string;
  fetcher: typeof fetch;
  lookups: Lookups;
}

function isAnswer(value: unknown): value is RadarAnswer {
  return AnswerSchema.safeParse(value).success;
}

export function radarAnswerFrom(body: unknown): RadarAnswer | null {
  const parsed = ResponseSchema.safeParse(body);
  if (!parsed.success || !parsed.data.success) {
    return null;
  }
  const details = parsed.data.result?.details_0;
  const rank = typeof details?.rank === "number" && Number.isInteger(details.rank) && details.rank > 0 ? details.rank : null;
  const bucket = details?.bucket && /^\d{1,9}$/.test(details.bucket) ? Number(details.bucket) : null;
  return {
    status: "ok",
    top: rank ?? (bucket && bucket > 0 ? bucket : null),
    warningCategory: (details?.categories ?? []).some((category) => warningCategories.test(category.name)),
  };
}

async function queryRadar(domain: string, options: RadarOptions): Promise<RadarAnswer | null> {
  const timer = deadline(3000);
  try {
    const response = await options.fetcher(`${radarEndpoint}${domain}?format=json`, {
      headers: { Authorization: `Bearer ${options.token}`, Accept: "application/json" },
      signal: timer.signal,
    });
    if (response.status === 404) {
      return { status: "ok", top: null, warningCategory: false };
    }
    if (!response.ok) {
      return null;
    }
    return radarAnswerFrom(await readLimitedJson(response, maxResponseBytes));
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export function isPopular(result: RadarResult): boolean {
  return result.status === "ok" && !result.warningCategory && result.top !== null && result.top <= radarPopularTop;
}

export async function lookupRadar(domain: string, options: RadarOptions): Promise<RadarResult> {
  if (!domainPattern.test(domain) || !options.token) {
    return { status: "unavailable" };
  }
  const { lookups } = options;
  const key = await cacheKey("radar-rank", domain);
  const hit = await readCached(lookups, key, isAnswer);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<RadarResult> => {
    if (!sourceIsOpen(lookups, radarSource)) {
      return { status: "unavailable" };
    }
    const answer = await queryRadar(domain, options);
    recordOutcome(lookups, radarSource, answer !== null);
    if (!answer) {
      return { status: "unavailable" };
    }
    await writeCached(lookups, key, answer, cacheSeconds);
    return answer;
  });
}
