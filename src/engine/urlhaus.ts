import { z } from "zod";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";

export const urlhausHostEndpoint = "https://urlhaus-api.abuse.ch/v1/host/";
export const urlhausSource = "urlhaus";
export const urlhausCacheSeconds = 15 * 60;
const maxResponseBytes = 1024 * 1024;

const HostSchema = z.object({
  query_status: z.string(),
  urlhaus_reference: z.string().optional(),
  url_count: z.union([z.string(), z.number()]).optional(),
  urls: z
    .array(z.object({ url: z.string(), url_status: z.string().optional(), threat: z.string().nullable().optional() }))
    .optional(),
});

const AnswerSchema = z.union([
  z.object({ status: z.literal("ok"), listed: z.literal(false) }),
  z.object({
    status: z.literal("ok"),
    listed: z.literal(true),
    reference: z.string().nullable(),
    total: z.number(),
    onlineUrls: z.array(z.string()),
    threats: z.array(z.string()),
  }),
]);

type UrlhausAnswer = z.infer<typeof AnswerSchema>;

export type UrlhausResult = UrlhausAnswer | { status: "unavailable" } | { status: "over_budget" };

export interface UrlhausOptions {
  authKey: string;
  fetcher: typeof fetch;
  lookups: Lookups;
  takeBudget: () => Promise<boolean>;
}

function referencePage(value: string | undefined): string | null {
  if (!value || !URL.canParse(value)) {
    return null;
  }
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "urlhaus.abuse.ch" && url.username === "" && url.password === "" ? url.href : null;
}

function isAnswer(value: unknown): value is UrlhausAnswer {
  return AnswerSchema.safeParse(value).success;
}

async function queryUrlhaus(host: string, authKey: string, fetcher: typeof fetch): Promise<UrlhausAnswer | null> {
  const timer = deadline(4000);
  try {
    const response = await fetcher(urlhausHostEndpoint, {
      method: "POST",
      headers: { "Auth-Key": authKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ host }).toString(),
      signal: timer.signal,
    });
    if (!response.ok) {
      return null;
    }
    const parsed = HostSchema.safeParse(await readLimitedJson(response, maxResponseBytes));
    if (!parsed.success) {
      return null;
    }
    if (parsed.data.query_status === "no_results") {
      return { status: "ok", listed: false };
    }
    if (parsed.data.query_status !== "ok") {
      return null;
    }
    const urls = parsed.data.urls ?? [];
    return {
      status: "ok",
      listed: true,
      reference: referencePage(parsed.data.urlhaus_reference),
      total: Number(parsed.data.url_count ?? urls.length) || urls.length,
      onlineUrls: urls.filter((entry) => entry.url_status === "online").map((entry) => entry.url),
      threats: [...new Set(urls.map((entry) => entry.threat).filter((threat): threat is string => Boolean(threat)))],
    };
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export async function lookupUrlhausHost(host: string, options: UrlhausOptions): Promise<UrlhausResult> {
  const { lookups } = options;
  const key = await cacheKey("urlhaus-host", host);
  const hit = await readCached(lookups, key, isAnswer);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<UrlhausResult> => {
    if (!sourceIsOpen(lookups, urlhausSource)) {
      return { status: "unavailable" };
    }
    if (!(await options.takeBudget())) {
      return { status: "over_budget" };
    }
    const answer = await queryUrlhaus(host, options.authKey, options.fetcher);
    recordOutcome(lookups, urlhausSource, answer !== null);
    if (!answer) {
      return { status: "unavailable" };
    }
    await writeCached(lookups, key, answer, urlhausCacheSeconds);
    return answer;
  });
}

export function sameUrl(a: string, b: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return normalize(a) === normalize(b);
}
