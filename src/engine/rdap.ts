import { z } from "zod";

export const rdapBootstrapUrl = "https://data.iana.org/rdap/dns.json";
const bootstrapTtlMs = 12 * 60 * 60 * 1000;

const BootstrapSchema = z.object({ services: z.array(z.tuple([z.array(z.string()), z.array(z.string())])) });
const DomainSchema = z.object({
  events: z.array(z.object({ eventAction: z.string(), eventDate: z.string().optional() })).optional(),
  status: z.array(z.string()).optional(),
});

let bootstrapCache: { fetchedAt: number; services: Map<string, string> } | null = null;

export function resetRdapCache(): void {
  bootstrapCache = null;
}

async function rdapBaseFor(tld: string, fetcher: typeof fetch): Promise<string | null | "unavailable"> {
  if (!bootstrapCache || Date.now() - bootstrapCache.fetchedAt > bootstrapTtlMs) {
    try {
      const response = await fetcher(rdapBootstrapUrl, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) {
        return "unavailable";
      }
      const parsed = BootstrapSchema.safeParse(await response.json());
      if (!parsed.success) {
        return "unavailable";
      }
      const services = new Map<string, string>();
      for (const [tlds, urls] of parsed.data.services) {
        const secure = urls.find((url) => url.startsWith("https://"));
        if (secure) {
          for (const entry of tlds) {
            services.set(entry.toLowerCase(), secure.endsWith("/") ? secure : `${secure}/`);
          }
        }
      }
      bootstrapCache = { fetchedAt: Date.now(), services };
    } catch {
      return "unavailable";
    }
  }
  return bootstrapCache.services.get(tld) ?? null;
}

export type RdapResult =
  | { status: "ok"; registeredAt: string | null; statuses: string[] }
  | { status: "not_found" }
  | { status: "not_applicable" }
  | { status: "unavailable" };

export async function lookupRdap(domain: string, fetcher: typeof fetch): Promise<RdapResult> {
  const tld = domain.split(".").pop()?.toLowerCase() ?? "";
  const base = await rdapBaseFor(tld, fetcher);
  if (base === "unavailable") {
    return { status: "unavailable" };
  }
  if (!base) {
    return { status: "not_applicable" };
  }
  try {
    const response = await fetcher(`${base}domain/${encodeURIComponent(domain)}`, {
      headers: { Accept: "application/rdap+json, application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) {
      return { status: "not_found" };
    }
    if (!response.ok) {
      return { status: "unavailable" };
    }
    const parsed = DomainSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { status: "unavailable" };
    }
    const registration = parsed.data.events?.find((event) => event.eventAction === "registration")?.eventDate ?? null;
    return { status: "ok", registeredAt: registration, statuses: parsed.data.status ?? [] };
  } catch {
    return { status: "unavailable" };
  }
}
