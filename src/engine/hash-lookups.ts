import { z } from "zod";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { dohEndpoint } from "./dns";
import type { HashCheck } from "./file-scan";
import { readLimitedJson } from "./limited-body";

export const malwareBazaarEndpoint = "https://mb-api.abuse.ch/api/v1/";
export const hashlookupEndpoint = "https://hashlookup.circl.lu/lookup/sha256/";
export const mhrZone = "hash.cymru.com";

export const hashSourceNames = {
  malwareBazaar: "MalwareBazaar (abuse.ch)",
  hashlookup: "CIRCL hashlookup",
  mhr: "Team Cymru Malware Hash Registry",
} as const;

export interface HashLookupOptions {
  fetcher: typeof fetch;
  lookups: Lookups;
  abuseChKey?: string | undefined;
  takeAbuseChBudget: () => Promise<boolean>;
}

const maxResponseBytes = 256 * 1024;
const hitCacheSeconds = 60 * 60;
const missCacheSeconds = 15 * 60;
const knownCacheSeconds = 24 * 60 * 60;
const mhrListedPercent = 25;

const BazaarSchema = z.object({
  query_status: z.string(),
  data: z
    .array(z.object({ signature: z.string().nullable().optional(), file_type: z.string().nullable().optional(), first_seen: z.string().nullable().optional(), tags: z.array(z.string()).nullable().optional() }))
    .optional(),
});

const HashlookupSchema = z.object({
  ProductCode: z.object({ ProductName: z.string().optional() }).passthrough().optional(),
  KnownMalicious: z.unknown().optional(),
  "hashlookup:trust": z.number().optional(),
}).passthrough();

const minimumTrust = 50;
const sourceLabel = /^[a-z0-9][a-z0-9.-]{1,60}$/i;

const TxtSchema = z.object({ Status: z.number(), Answer: z.array(z.object({ type: z.number(), data: z.string(), TTL: z.number().optional() })).optional() });

const CachedSchema = z.object({
  status: z.enum(["listed", "known_good", "clean", "flagged"]),
  source: z.string(),
  sourceUrl: z.string().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
});

function isCached(value: unknown): value is HashCheck {
  return CachedSchema.safeParse(value).success;
}

async function remembered(key: string, lookups: Lookups, source: string, load: () => Promise<{ check: HashCheck; seconds: number } | null>): Promise<HashCheck> {
  const hit = await readCached(lookups, key, isCached);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<HashCheck> => {
    if (!sourceIsOpen(lookups, source)) {
      return { status: "unavailable", source };
    }
    const result = await load().catch(() => null);
    recordOutcome(lookups, source, result !== null);
    if (!result) {
      return { status: "unavailable", source };
    }
    if (result.check.status !== "over_budget") {
      await writeCached(lookups, key, result.check, result.seconds);
    }
    return result.check;
  });
}

function bazaarDate(value: string | null | undefined): string {
  const parsed = value ? Date.parse(`${value.replace(" ", "T")}Z`) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "an unknown date";
}

async function malwareBazaar(sha256: string, options: HashLookupOptions): Promise<HashCheck> {
  const source = hashSourceNames.malwareBazaar;
  if (!options.abuseChKey) {
    return { status: "not_configured", source };
  }
  const key = await cacheKey("malwarebazaar", sha256);
  const authKey = options.abuseChKey;
  return remembered(key, options.lookups, source, async () => {
    if (!(await options.takeAbuseChBudget())) {
      return { check: { status: "over_budget", source }, seconds: 0 };
    }
    const timer = deadline(4000);
    try {
      const response = await options.fetcher(malwareBazaarEndpoint, {
        method: "POST",
        headers: { "Auth-Key": authKey, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ query: "get_info", hash: sha256 }).toString(),
        signal: timer.signal,
      });
      if (!response.ok) {
        return null;
      }
      const parsed = BazaarSchema.safeParse(await readLimitedJson(response, maxResponseBytes));
      if (!parsed.success) {
        return null;
      }
      if (parsed.data.query_status === "hash_not_found") {
        return { check: { status: "clean", source }, seconds: missCacheSeconds };
      }
      const sample = parsed.data.data?.[0];
      if (parsed.data.query_status !== "ok" || !sample) {
        return null;
      }
      const signature = sample.signature?.replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 60).trim();
      const family = signature ? ` as ${signature}` : "";
      return {
        check: {
          status: "listed",
          source,
          sourceUrl: "https://bazaar.abuse.ch/",
          title: `MalwareBazaar lists this exact file${family}`,
          detail: `abuse.ch's MalwareBazaar collects malware samples shared by security researchers. This file is one of them, first seen on ${bazaarDate(sample.first_seen)}. Do not open it.`,
        },
        seconds: hitCacheSeconds,
      };
    } finally {
      timer.clear();
    }
  });
}

async function hashlookup(sha256: string, options: HashLookupOptions): Promise<HashCheck> {
  const source = hashSourceNames.hashlookup;
  const key = await cacheKey("hashlookup", sha256);
  return remembered(key, options.lookups, source, async () => {
    const timer = deadline(4000);
    try {
      const response = await options.fetcher(`${hashlookupEndpoint}${sha256}`, { headers: { Accept: "application/json" }, signal: timer.signal });
      if (response.status === 404) {
        await response.body?.cancel();
        return { check: { status: "clean", source }, seconds: knownCacheSeconds };
      }
      if (!response.ok) {
        return null;
      }
      const parsed = HashlookupSchema.safeParse(await readLimitedJson(response, maxResponseBytes));
      if (!parsed.success) {
        return null;
      }
      const malicious = parsed.data.KnownMalicious;
      if (malicious !== undefined && malicious !== null && malicious !== false && malicious !== "") {
        const reporter = typeof malicious === "string" && sourceLabel.test(malicious) ? ` (reported by ${malicious})` : "";
        return {
          check: {
            status: "listed",
            source,
            sourceUrl: "https://hashlookup.circl.lu/",
            title: "CIRCL hashlookup marks this exact file as known malware",
            detail: `CIRCL's hashlookup service has this file on record from a malware collection${reporter}. Do not open it.`,
          },
          seconds: knownCacheSeconds,
        };
      }
      if ((parsed.data["hashlookup:trust"] ?? minimumTrust) < minimumTrust) {
        return { check: { status: "clean", source }, seconds: knownCacheSeconds };
      }
      const product = parsed.data.ProductCode?.ProductName?.replace(/[^\p{L}\p{N} .,:+()&'-]/gu, "").slice(0, 80).trim();
      return {
        check: {
          status: "known_good",
          source,
          sourceUrl: "https://hashlookup.circl.lu/",
          title: "Found in a library of known software",
          detail: `CIRCL hashlookup knows this file from collections of published software, such as NIST's National Software Reference Library${product ? ` (${product})` : ""}. That is not proof it is safe: these libraries also hold security tools and old programs that can be misused.`,
        },
        seconds: knownCacheSeconds,
      };
    } finally {
      timer.clear();
    }
  });
}

async function malwareHashRegistry(sha1: string, options: HashLookupOptions): Promise<HashCheck> {
  const source = hashSourceNames.mhr;
  const key = await cacheKey("mhr", sha1);
  return remembered(key, options.lookups, source, async () => {
    const timer = deadline(3000);
    try {
      const query = new URLSearchParams({ name: `${sha1}.${mhrZone}`, type: "TXT" });
      const response = await options.fetcher(`${dohEndpoint}?${query}`, { headers: { Accept: "application/dns-json" }, signal: timer.signal });
      if (!response.ok) {
        return null;
      }
      const parsed = TxtSchema.safeParse(await readLimitedJson(response, 16 * 1024));
      if (!parsed.success) {
        return null;
      }
      if (parsed.data.Status === 3) {
        return { check: { status: "clean", source }, seconds: missCacheSeconds };
      }
      const answer = parsed.data.Status === 0 ? parsed.data.Answer?.find((record) => record.type === 16) : undefined;
      const match = answer ? /^"?(\d{9,11}) (\d{1,3})"?$/.exec(answer.data.trim()) : null;
      if (!match) {
        return null;
      }
      const percent = Math.min(100, Number(match[2]));
      const listed = percent >= mhrListedPercent;
      return {
        check: {
          status: listed ? "listed" : "flagged",
          source,
          sourceUrl: "https://www.team-cymru.com/mhr",
          title: listed ? "Antivirus engines flag this exact file as malware" : "A few antivirus engines flag this exact file",
          detail: `Team Cymru's Malware Hash Registry reports that about ${percent}% of the antivirus engines it follows detect this file.${listed ? " Do not open it." : " A low share can be a false alarm, but treat the file with care."}`,
        },
        seconds: hitCacheSeconds,
      };
    } finally {
      timer.clear();
    }
  });
}

export async function lookupFileHashes(hashes: { sha256: string; sha1?: string | undefined }, options: HashLookupOptions): Promise<HashCheck[]> {
  return Promise.all([
    malwareBazaar(hashes.sha256, options),
    hashlookup(hashes.sha256, options),
    ...(hashes.sha1 ? [malwareHashRegistry(hashes.sha1, options)] : []),
  ]);
}
