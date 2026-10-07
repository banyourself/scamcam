import { dohEndpoint, filteredDohEndpoint } from "../../src/engine/dns";
import type { DomainListLookup, DomainListResult } from "../../src/engine/domain-list";
import { hashlookupEndpoint, malwareBazaarEndpoint, mhrZone } from "../../src/engine/hash-lookups";
import { rdapBootstrapUrl } from "../../src/engine/rdap";
import { safeBrowsingEndpoint } from "../../src/engine/safe-browsing";
import { threatfoxEndpoint } from "../../src/engine/threatfox";
import { urlhausHostEndpoint } from "../../src/engine/urlhaus";
import { protobufResponse, type SearchResponseFixture } from "./safe-browsing-wire";

export interface FakeNetworkOptions {
  registeredDaysAgo?: number | "missing";
  rdapStatus?: string[];
  dnsStatus?: number;
  filteredHosts?: string[];
  filterDown?: boolean;
  safeBrowsing?: (prefixes: string[]) => SearchResponseFixture;
  urlhaus?: unknown;
  turnstile?: unknown;
  malware?: Record<string, string | null>;
  knownFiles?: string[];
  knownMalware?: Record<string, string>;
  threatfox?: Record<string, { malware: string; confidence: number }>;
  lowTrustFiles?: string[];
  antivirus?: Record<string, number>;
  down?: boolean;
  now?: Date;
}

export interface FakeNetwork {
  fetcher: typeof fetch;
  requests: { url: string; body: string }[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function fakeNetwork(options: FakeNetworkOptions = {}): FakeNetwork {
  const requests: { url: string; body: string }[] = [];
  const now = options.now ?? new Date();
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = init?.body instanceof FormData ? [...init.body.entries()].map(([key, value]) => `${key}=${String(value)}`).join("&") : String(init?.body ?? "");
    requests.push({ url, body });
    if (options.down) {
      throw new TypeError("network down");
    }
    if (url === rdapBootstrapUrl) {
      return json({
        services: [
          [["com", "net"], ["https://rdap.registry.test/com/v1/"]],
          [["example", "org", "ru", "co", "info"], ["https://rdap.registry.test/other/"]],
        ],
      });
    }
    if (url.startsWith("https://rdap.registry.test/")) {
      if (options.registeredDaysAgo === "missing") {
        return json({ errorCode: 404 }, 404);
      }
      const days = options.registeredDaysAgo ?? 4000;
      return json({
        events: [{ eventAction: "registration", eventDate: new Date(now.getTime() - days * 86_400_000).toISOString() }],
        status: options.rdapStatus ?? ["active"],
      });
    }
    if (url.startsWith(filteredDohEndpoint)) {
      if (options.filterDown) {
        return json({ error: "down" }, 502);
      }
      const name = new URL(url).searchParams.get("name") ?? "";
      if (options.filteredHosts?.includes(name)) {
        return json({ Status: 0, Answer: [{ type: 1, TTL: 60, data: "0.0.0.0" }], Comment: ["EDE(16): Censored"] });
      }
      return json({ Status: options.dnsStatus ?? 0, Answer: [{ type: 1, TTL: 300, data: "203.0.113.10" }] });
    }
    if (url.startsWith(dohEndpoint) && new URL(url).searchParams.get("type") === "TXT") {
      const name = new URL(url).searchParams.get("name") ?? "";
      const sha1 = name.endsWith(`.${mhrZone}`) ? name.slice(0, -mhrZone.length - 1) : "";
      const percent = options.antivirus?.[sha1];
      return percent === undefined
        ? json({ Status: 3, Authority: [{ type: 6, TTL: 900, data: "ns1.hash.cymru.com." }] })
        : json({ Status: 0, Answer: [{ type: 16, TTL: 86400, data: `"1790790651 ${percent}"` }] });
    }
    if (url.startsWith(dohEndpoint)) {
      return json({ Status: options.dnsStatus ?? 0, Answer: [{ type: 1, data: "203.0.113.10" }] });
    }
    if (url === threatfoxEndpoint) {
      const term = (JSON.parse(body) as { search_term?: string }).search_term ?? "";
      const listed = options.threatfox?.[term];
      return listed
        ? json({ query_status: "ok", data: [{ id: "1234567", ioc: term, ioc_type: "domain", threat_type: "payload_delivery", malware_printable: listed.malware, confidence_level: listed.confidence }] })
        : json({ query_status: "no_result", data: "Your search did not yield any results" });
    }
    if (url === malwareBazaarEndpoint) {
      const hash = new URLSearchParams(body).get("hash") ?? "";
      if (options.malware && hash in options.malware) {
        return json({ query_status: "ok", data: [{ signature: options.malware[hash], file_type: "exe", first_seen: "2026-09-30 10:15:00", tags: ["exe"] }] });
      }
      return json({ query_status: "hash_not_found" });
    }
    if (url.startsWith(hashlookupEndpoint)) {
      const hash = url.slice(hashlookupEndpoint.length);
      if (options.knownMalware?.[hash]) {
        return json({ FileName: "eicar.com", KnownMalicious: options.knownMalware[hash], "hashlookup:trust": 100 });
      }
      if (options.lowTrustFiles?.includes(hash)) {
        return json({ FileName: "tool.exe", "hashlookup:trust": 20 });
      }
      return options.knownFiles?.includes(hash)
        ? json({ FileName: "setup.exe", ProductCode: { ProductName: "Example Game Launcher" }, "hashlookup:trust": 75 })
        : json({ message: "Non existing SHA-256" }, 404);
    }
    if (url.startsWith(safeBrowsingEndpoint)) {
      const prefixes = new URL(url).searchParams.getAll("hashPrefixes");
      return protobufResponse(options.safeBrowsing ? options.safeBrowsing(prefixes) : {});
    }
    if (url === urlhausHostEndpoint) {
      return json(options.urlhaus ?? { query_status: "no_results" });
    }
    if (url.includes("challenges.cloudflare.com")) {
      return json(options.turnstile ?? { success: true, hostname: "scamcam.kevinle.tech", action: "scan" });
    }
    return json({ error: "unexpected request" }, 404);
  };
  return { fetcher, requests };
}

export const allowAllBudgets = async () => true;

export function listOf(names: string[], asked: string[][] = []): DomainListLookup {
  const listed = new Set(names);
  return {
    async lookup(requested: string[]): Promise<DomainListResult> {
      asked.push(requested);
      return { status: "ok", listed: new Set(requested.filter((name) => listed.has(name))), syncedAt: 0 };
    },
  };
}

export function listInState(status: "stale" | "not_configured" | "unavailable"): DomainListLookup {
  return { lookup: async () => ({ status }) };
}
