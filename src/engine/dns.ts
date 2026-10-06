import { z } from "zod";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";

export const dohEndpoint = "https://cloudflare-dns.com/dns-query";
export const dnsSource = "dns";

const RecordSchema = z.object({ type: z.number(), data: z.string(), TTL: z.number().optional() });

const DohSchema = z.object({
  Status: z.number(),
  Answer: z.array(RecordSchema).optional(),
  Authority: z.array(RecordSchema).optional(),
});

const AnswerSchema = z.object({ status: z.literal("ok"), exists: z.boolean(), addresses: z.array(z.string()) });

type DnsAnswer = z.infer<typeof AnswerSchema>;

export type DnsResult = DnsAnswer | { status: "unavailable" };

const minCacheSeconds = 60;
const maxCacheSeconds = 3600;
const maxMissingCacheSeconds = 900;
const defaultMissingCacheSeconds = 300;

function isAnswer(value: unknown): value is DnsAnswer {
  return AnswerSchema.safeParse(value).success;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

async function queryDns(hostname: string, fetcher: typeof fetch): Promise<{ answer: DnsAnswer; ttl: number } | null> {
  try {
    const query = new URLSearchParams({ name: hostname, type: "A" });
    const response = await fetcher(`${dohEndpoint}?${query}`, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return null;
    }
    const parsed = DohSchema.safeParse(await response.json());
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
