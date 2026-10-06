import { z } from "zod";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";

export const dohEndpoint = "https://cloudflare-dns.com/dns-query";
export const dnsSource = "dns";
export const filteredDohEndpoint = "https://security.cloudflare-dns.com/dns-query";
export const filteredDnsSource = "dns_filter";

const RecordSchema = z.object({ type: z.number(), data: z.string(), TTL: z.number().optional() });

const DohSchema = z.object({
  Status: z.number(),
  Answer: z.array(RecordSchema).optional(),
  Authority: z.array(RecordSchema).optional(),
  Comment: z.union([z.string(), z.array(z.string())]).optional(),
});

const AnswerSchema = z.object({ status: z.literal("ok"), exists: z.boolean(), addresses: z.array(z.string()) });

type DnsAnswer = z.infer<typeof AnswerSchema>;

export type DnsResult = DnsAnswer | { status: "unavailable" };

const FilterAnswerSchema = z.object({ status: z.literal("ok"), blocked: z.boolean() });

type FilterAnswer = z.infer<typeof FilterAnswerSchema>;

export type FilterResult = FilterAnswer | { status: "unavailable" };

const filterBlockCodes = /\bEDE\((?:15|16|17)\)/;
const minFilterCacheSeconds = 300;

const minCacheSeconds = 60;
const maxCacheSeconds = 3600;
const maxMissingCacheSeconds = 900;
const defaultMissingCacheSeconds = 300;
const maxResponseBytes = 64 * 1024;

function isAnswer(value: unknown): value is DnsAnswer {
  return AnswerSchema.safeParse(value).success;
}

function isFilterAnswer(value: unknown): value is FilterAnswer {
  return FilterAnswerSchema.safeParse(value).success;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

async function queryDns(hostname: string, fetcher: typeof fetch): Promise<{ answer: DnsAnswer; ttl: number } | null> {
  const timer = deadline(3000);
  try {
    const query = new URLSearchParams({ name: hostname, type: "A" });
    const response = await fetcher(`${dohEndpoint}?${query}`, {
      headers: { Accept: "application/dns-json" },
      signal: timer.signal,
    });
    if (!response.ok) {
      return null;
    }
    const parsed = DohSchema.safeParse(await readLimitedJson(response, maxResponseBytes));
    if (!parsed.success) {
      return null;
    }
    if (parsed.data.Status === 3) {
      const soaTtl = parsed.data.Authority?.find((record) => record.type === 6)?.TTL;
      const ttl = soaTtl === undefined ? defaultMissingCacheSeconds : clamp(soaTtl, minCacheSeconds, maxMissingCacheSeconds);
      return { answer: { status: "ok", exists: false, addresses: [] }, ttl };
    }
    if (parsed.data.Status !== 0) {
      return null;
    }
    const answers = parsed.data.Answer ?? [];
    const ttls = answers.map((record) => record.TTL).filter((ttl): ttl is number => typeof ttl === "number");
    const ttl = ttls.length > 0 ? clamp(Math.min(...ttls), minCacheSeconds, maxCacheSeconds) : minCacheSeconds;
    const addresses = answers.filter((record) => record.type === 1).map((record) => record.data);
    return { answer: { status: "ok", exists: true, addresses }, ttl };
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export async function lookupDns(hostname: string, fetcher: typeof fetch, lookups: Lookups): Promise<DnsResult> {
  const key = await cacheKey("dns-a", hostname);
  const hit = await readCached(lookups, key, isAnswer);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<DnsResult> => {
    if (!sourceIsOpen(lookups, dnsSource)) {
      return { status: "unavailable" };
    }
    const result = await queryDns(hostname, fetcher);
    recordOutcome(lookups, dnsSource, result !== null);
    if (!result) {
      return { status: "unavailable" };
    }
    await writeCached(lookups, key, result.answer, result.ttl);
    return result.answer;
  });
}

export function isPrivateAddress(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function queryFilter(hostname: string, fetcher: typeof fetch): Promise<{ answer: FilterAnswer; ttl: number } | null> {
  const timer = deadline(3000);
  try {
    const query = new URLSearchParams({ name: hostname, type: "A" });
    const response = await fetcher(`${filteredDohEndpoint}?${query}`, {
      headers: { Accept: "application/dns-json" },
      signal: timer.signal,
    });
    if (!response.ok) {
      return null;
    }
    const parsed = DohSchema.safeParse(await readLimitedJson(response, maxResponseBytes));
    if (!parsed.success || (parsed.data.Status !== 0 && parsed.data.Status !== 3)) {
      return null;
    }
    const addresses = (parsed.data.Answer ?? []).filter((record) => record.type === 1);
    const comments = [parsed.data.Comment ?? []].flat();
    const blocked =
      parsed.data.Status === 0 &&
      addresses.length > 0 &&
      addresses.every((record) => record.data === "0.0.0.0") &&
      comments.some((comment) => filterBlockCodes.test(comment));
    const ttls = addresses.map((record) => record.TTL).filter((ttl): ttl is number => typeof ttl === "number");
    const ttl = clamp(ttls.length > 0 ? Math.min(...ttls) : minFilterCacheSeconds, minFilterCacheSeconds, maxCacheSeconds);
    return { answer: { status: "ok", blocked }, ttl };
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export async function lookupFilteredDns(hostname: string, fetcher: typeof fetch, lookups: Lookups): Promise<FilterResult> {
  const key = await cacheKey("dns-filter", hostname);
  const hit = await readCached(lookups, key, isFilterAnswer);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<FilterResult> => {
    if (!sourceIsOpen(lookups, filteredDnsSource)) {
      return { status: "unavailable" };
    }
    const result = await queryFilter(hostname, fetcher);
    recordOutcome(lookups, filteredDnsSource, result !== null);
    if (!result) {
      return { status: "unavailable" };
    }
    await writeCached(lookups, key, result.answer, result.ttl);
    return result.answer;
  });
}
