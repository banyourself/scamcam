import { z } from "zod";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";

export const dohEndpoint = "https://cloudflare-dns.com/dns-query";
export const filteredDohEndpoint = "https://security.cloudflare-dns.com/dns-query";
export const filteredDnsSource = "dns_filter";

const RecordSchema = z.object({ type: z.number(), data: z.string(), TTL: z.number().optional() });

const DohSchema = z.object({
  Status: z.number(),
  Answer: z.array(RecordSchema).optional(),
  Authority: z.array(RecordSchema).optional(),
  Comment: z.union([z.string(), z.array(z.string())]).optional(),
});

const HostAnswerSchema = z.object({ status: z.literal("ok"), blocked: z.boolean(), exists: z.boolean(), addresses: z.array(z.string()) });

type HostAnswer = z.infer<typeof HostAnswerSchema>;

export type HostResult = HostAnswer | { status: "unavailable" };

const filterBlockCodes = /\bEDE\((?:15|16|17)\)/;
const minBlockedCacheSeconds = 300;
const minCacheSeconds = 60;
const maxCacheSeconds = 3600;
const maxMissingCacheSeconds = 900;
const defaultMissingCacheSeconds = 300;
const maxResponseBytes = 64 * 1024;

function isHostAnswer(value: unknown): value is HostAnswer {
  return HostAnswerSchema.safeParse(value).success;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function isPrivateAddress(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function queryHost(hostname: string, fetcher: typeof fetch): Promise<{ answer: HostAnswer; ttl: number } | null> {
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
    if (!parsed.success) {
      return null;
    }
    if (parsed.data.Status === 3) {
      const soaTtl = parsed.data.Authority?.find((record) => record.type === 6)?.TTL;
      const ttl = soaTtl === undefined ? defaultMissingCacheSeconds : clamp(soaTtl, minCacheSeconds, maxMissingCacheSeconds);
      return { answer: { status: "ok", blocked: false, exists: false, addresses: [] }, ttl };
    }
    if (parsed.data.Status !== 0) {
      return null;
    }
    const records = (parsed.data.Answer ?? []).filter((record) => record.type === 1);
    const comments = [parsed.data.Comment ?? []].flat();
    const blocked = records.length > 0 && records.every((record) => record.data === "0.0.0.0") && comments.some((comment) => filterBlockCodes.test(comment));
    const ttls = (parsed.data.Answer ?? []).map((record) => record.TTL).filter((ttl): ttl is number => typeof ttl === "number");
    const shortest = ttls.length > 0 ? Math.min(...ttls) : minCacheSeconds;
    return {
      answer: { status: "ok", blocked, exists: true, addresses: blocked ? [] : records.map((record) => record.data) },
      ttl: clamp(shortest, blocked ? minBlockedCacheSeconds : minCacheSeconds, maxCacheSeconds),
    };
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export async function lookupHost(hostname: string, fetcher: typeof fetch, lookups: Lookups): Promise<HostResult> {
  const key = await cacheKey("dns-host", hostname);
  const hit = await readCached(lookups, key, isHostAnswer);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<HostResult> => {
    if (!sourceIsOpen(lookups, filteredDnsSource)) {
      return { status: "unavailable" };
    }
    const result = await queryHost(hostname, fetcher);
    recordOutcome(lookups, filteredDnsSource, result !== null);
    if (!result) {
      return { status: "unavailable" };
    }
    await writeCached(lookups, key, result.answer, result.ttl);
    return result.answer;
  });
}
