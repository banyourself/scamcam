import { z } from "zod";
import { cacheKey, readCached, recallFromMemory, recordOutcome, rememberInMemory, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { readLimitedJson } from "./limited-body";

export const rdapBootstrapUrl = "https://data.iana.org/rdap/dns.json";
export const rdapBootstrapSource = "rdap:bootstrap";

const bootstrapCacheSeconds = 12 * 60 * 60;
const registeredCacheSeconds = 24 * 60 * 60;
const missingCacheSeconds = 60 * 60;
const defaultBackoffSeconds = 300;
const maxBackoffSeconds = 3600;
const maxResponseBytes = 512 * 1024;

const BootstrapSchema = z.object({ services: z.array(z.tuple([z.array(z.string()), z.array(z.string())])) });
const DomainSchema = z.object({
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string().optional() })).optional(),
  status: z.array(z.string()).optional(),
});
const ServicePairsSchema = z.array(z.tuple([z.string(), z.string()]));
const AnswerSchema = z.union([
  z.object({ status: z.literal("ok"), registeredAt: z.string().nullable(), statuses: z.array(z.string()) }),
  z.object({ status: z.literal("not_found") }),
]);

type RdapAnswer = z.infer<typeof AnswerSchema>;
type ServicePairs = z.infer<typeof ServicePairsSchema>;

export type RdapResult = RdapAnswer | { status: "not_applicable" } | { status: "unavailable" };

function isServicePairs(value: unknown): value is ServicePairs {
  return ServicePairsSchema.safeParse(value).success;
}

function isAnswer(value: unknown): value is RdapAnswer {
  return AnswerSchema.safeParse(value).success;
}

async function fetchBootstrap(fetcher: typeof fetch): Promise<ServicePairs | null> {
  try {
    const response = await fetcher(rdapBootstrapUrl, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) {
      return null;
    }
    const parsed = BootstrapSchema.safeParse(await readLimitedJson(response, maxResponseBytes));
    if (!parsed.success) {
      return null;
    }
    const pairs: ServicePairs = [];
    for (const [tlds, urls] of parsed.data.services) {
      const secure = urls.find((url) => url.startsWith("https://"));
      if (secure) {
        for (const entry of tlds) {
          pairs.push([entry.toLowerCase(), secure.endsWith("/") ? secure : `${secure}/`]);
        }
      }
    }
    return pairs;
  } catch {
    return null;
  }
}

async function registryServices(lookups: Lookups, fetcher: typeof fetch): Promise<Map<string, string> | null> {
  const remembered = recallFromMemory(lookups, rdapBootstrapSource);
  if (remembered instanceof Map) {
    return remembered as Map<string, string>;
  }
  const key = await cacheKey("rdap-bootstrap", rdapBootstrapUrl);
  const pairs =
    (await readCached(lookups, key, isServicePairs)) ??
    (await sharedLoad(lookups, key, async () => {
      if (!sourceIsOpen(lookups, rdapBootstrapSource)) {
        return null;
      }
      const loaded = await fetchBootstrap(fetcher);
      recordOutcome(lookups, rdapBootstrapSource, loaded !== null);
      if (loaded) {
        await writeCached(lookups, key, loaded, bootstrapCacheSeconds);
      }
      return loaded;
    }));
  if (!pairs) {
    return null;
  }
  const services = new Map(pairs);
  rememberInMemory(lookups, rdapBootstrapSource, services, bootstrapCacheSeconds);
  return services;
}

function backoffSeconds(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.ceil(seconds), maxBackoffSeconds) : defaultBackoffSeconds;
}

export async function lookupRdap(domain: string, fetcher: typeof fetch, lookups: Lookups): Promise<RdapResult> {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  const services = await registryServices(lookups, fetcher);
  if (!services) {
    return { status: "unavailable" };
  }
  const base = services.get(tld);
  if (!base) {
    return { status: "not_applicable" };
  }
  const key = await cacheKey("rdap-domain", domain);
  const hit = await readCached(lookups, key, isAnswer);
  if (hit) {
    return hit;
  }
  const backoffKey = await cacheKey("rdap-backoff", base);
  if (recallFromMemory(lookups, backoffKey) === true) {
    return { status: "unavailable" };
  }
  const source = `rdap:${base}`;
  return sharedLoad(lookups, key, async (): Promise<RdapResult> => {
    if (!sourceIsOpen(lookups, source)) {
      return { status: "unavailable" };
    }
    try {
      const response = await fetcher(`${base}domain/${encodeURIComponent(domain)}`, {
        headers: { Accept: "application/rdap+json, application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 429) {
        recordOutcome(lookups, source, false);
        rememberInMemory(lookups, backoffKey, true, backoffSeconds(response.headers.get("retry-after")));
        return { status: "unavailable" };
      }
      if (response.status === 404) {
        recordOutcome(lookups, source, true);
        const missing: RdapAnswer = { status: "not_found" };
        await writeCached(lookups, key, missing, missingCacheSeconds);
        return missing;
      }
      if (!response.ok) {
        recordOutcome(lookups, source, false);
        return { status: "unavailable" };
      }
      const parsed = DomainSchema.safeParse(await readLimitedJson(response, maxResponseBytes));
      if (!parsed.success) {
        recordOutcome(lookups, source, false);
        return { status: "unavailable" };
      }
      recordOutcome(lookups, source, true);
      const registration = parsed.data.events?.find((event) => event.eventAction === "registration")?.eventDate ?? null;
      const answer: RdapAnswer = { status: "ok", registeredAt: registration, statuses: parsed.data.status ?? [] };
      await writeCached(lookups, key, answer, registeredCacheSeconds);
      return answer;
    } catch {
      recordOutcome(lookups, source, false);
      return { status: "unavailable" };
    }
  });
}
