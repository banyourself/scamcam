import { z } from "zod";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";

export const phishstatsEndpoint = "https://api.phishstats.info/api/phishing";
export const phishstatsHomePage = "https://phishstats.info/";
export const phishstatsSource = "phishstats";
const cacheSeconds = 6 * 60 * 60;
const maxResponseBytes = 512 * 1024;
const pageSize = 30;
const popularRank = 100_000;
const hostPattern = /^(?=.{1,200}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

const RecordSchema = z.object({
  url: z.string().max(8192),
  date: z.string().max(64).nullable().optional(),
  rank_host: z.number().nullable().optional(),
});

const ReportsSchema = z.object({ reports: z.number().int().min(0), latest: z.string().nullable() });

const AnswerSchema = z.object({
  status: z.literal("ok"),
  exactHost: ReportsSchema,
  sameSite: ReportsSchema,
  popular: z.boolean(),
});

export type PhishstatsAnswer = z.infer<typeof AnswerSchema>;
export type PhishstatsResult = PhishstatsAnswer | { status: "unavailable" } | { status: "over_budget" };

export interface PhishstatsTarget {
  hostname: string;
  registrableDomain: string;
  privateSuffix: boolean;
}

export interface PhishstatsOptions {
  apiKey: string;
  fetcher: typeof fetch;
  lookups: Lookups;
  takeBudget: () => Promise<boolean>;
}

function isAnswer(value: unknown): value is PhishstatsAnswer {
  return AnswerSchema.safeParse(value).success;
}

export function phishstatsUrl(target: PhishstatsTarget): string | null {
  if (!hostPattern.test(target.hostname) || !hostPattern.test(target.registrableDomain)) {
    return null;
  }
  const where = target.privateSuffix ? `(url,like,https://${target.hostname}~)~or(url,like,http://${target.hostname}~)` : `(host,eq,${target.registrableDomain})`;
  return `${phishstatsEndpoint}?_where=${where}&_sort=-id&_size=${pageSize}`;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function dayOf(value: string | null | undefined): string | null {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function later(current: string | null, next: string | null): string | null {
  if (!next) {
    return current;
  }
  return !current || next > current ? next : current;
}

export function summarizeRecords(records: unknown[], target: PhishstatsTarget): PhishstatsAnswer {
  const answer: PhishstatsAnswer = { status: "ok", exactHost: { reports: 0, latest: null }, sameSite: { reports: 0, latest: null }, popular: false };
  for (const item of records) {
    const parsed = RecordSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const host = hostOf(parsed.data.url);
    if (!host) {
      continue;
    }
    const day = dayOf(parsed.data.date);
    if (host === target.hostname) {
      answer.exactHost.reports += 1;
      answer.exactHost.latest = later(answer.exactHost.latest, day);
    } else if (!target.privateSuffix && (host === target.registrableDomain || host.endsWith(`.${target.registrableDomain}`))) {
      answer.sameSite.reports += 1;
      answer.sameSite.latest = later(answer.sameSite.latest, day);
    } else {
      continue;
    }
    const rank = parsed.data.rank_host;
    if (typeof rank === "number" && rank > 0 && rank <= popularRank) {
      answer.popular = true;
    }
  }
  return answer;
}

async function queryPhishstats(url: string, target: PhishstatsTarget, options: PhishstatsOptions): Promise<PhishstatsAnswer | null> {
  const timer = deadline(4000);
  try {
    const response = await options.fetcher(url, { headers: { "X-API-Key": options.apiKey, Accept: "application/json" }, signal: timer.signal });
    if (!response.ok) {
      return null;
    }
    const body = await readLimitedJson(response, maxResponseBytes);
    return Array.isArray(body) ? summarizeRecords(body, target) : null;
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export async function lookupPhishstats(target: PhishstatsTarget, options: PhishstatsOptions): Promise<PhishstatsResult> {
  const url = phishstatsUrl(target);
  if (!url) {
    return { status: "unavailable" };
  }
  const { lookups } = options;
  const key = await cacheKey("phishstats", `${target.hostname}|${target.registrableDomain}|${target.privateSuffix}`);
  const hit = await readCached(lookups, key, isAnswer);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<PhishstatsResult> => {
    if (!sourceIsOpen(lookups, phishstatsSource)) {
      return { status: "unavailable" };
    }
    if (!(await options.takeBudget())) {
      return { status: "over_budget" };
    }
    const answer = await queryPhishstats(url, target, options);
    recordOutcome(lookups, phishstatsSource, answer !== null);
    if (!answer) {
      return { status: "unavailable" };
    }
    await writeCached(lookups, key, answer, cacheSeconds);
    return answer;
  });
}
