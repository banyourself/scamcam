import { discordInviteEndpoint } from "../../src/engine/discord-invite";
import { dohEndpoint, filteredDohEndpoint } from "../../src/engine/dns";
import type { DomainListLookup, DomainListResults, ListName } from "../../src/engine/domain-list";
import { hashlookupEndpoint, malwareBazaarEndpoint, mhrZone } from "../../src/engine/hash-lookups";
import { modrinthApi } from "../../src/engine/modrinth";
import { phishstatsEndpoint } from "../../src/engine/phishstats";
import { radarEndpoint } from "../../src/engine/radar";
import { rdapBootstrapUrl } from "../../src/engine/rdap";
import { safeBrowsingEndpoint } from "../../src/engine/safe-browsing";
import type { DnsAnswer, DnsTransport } from "../../src/engine/spamhaus";
import { bitlyExpandEndpoint, isgdEndpoints } from "../../src/engine/short-links";
import { steamApiBase } from "../../src/engine/steam";
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
  phishstats?: { url: string; host: string; date: string; rank_host?: number | null }[];
  phishstatsStatus?: number;
  radar?: Record<string, { rank?: number; bucket?: string; categories?: string[] }>;
  discord?: Record<string, FakeDiscordServer>;
  discordStatus?: number;
  steam?: Record<string, FakeSteamAccount>;
  steamVanity?: Record<string, string>;
  steamStatus?: number;
  shortLinks?: Record<string, string>;
  bitlyStatus?: number;
  modrinthFiles?: Record<string, { project: string; version: string; published?: string; status?: string }>;
  modrinthProjects?: FakeModrinthProject[];
  modrinthStatus?: number;
  down?: boolean;
  now?: Date;
}

export interface FakeModrinthProject {
  id: string;
  slug: string;
  title: string;
  downloads: number;
  type?: string;
  status?: string;
}

export interface FakeDiscordServer {
  name?: string;
  createdDaysAgo?: number;
  features?: string[];
  members?: number;
  groupChat?: boolean;
}

export interface FakeSteamAccount {
  economyBan?: string;
  communityBanned?: boolean;
  vacBans?: number;
  gameBans?: number;
  name?: string;
  createdDaysAgo?: number;
  visibility?: number;
}

const discordEpoch = 1420070400000;

export interface FakeNetwork {
  fetcher: typeof fetch;
  requests: { url: string; body: string; headers: Headers }[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function fakeNetwork(options: FakeNetworkOptions = {}): FakeNetwork {
  const requests: { url: string; body: string; headers: Headers }[] = [];
  const now = options.now ?? new Date();
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = init?.body instanceof FormData ? [...init.body.entries()].map(([key, value]) => `${key}=${String(value)}`).join("&") : String(init?.body ?? "");
    requests.push({ url, body, headers: new Headers(init?.headers) });
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
    if (url.startsWith(phishstatsEndpoint)) {
      if (options.phishstatsStatus) {
        return json({ error: "Daily API quota reached" }, options.phishstatsStatus);
      }
      const where = new URL(url).searchParams.get("_where") ?? "";
      const byHost = /^\(host,eq,([^)]+)\)$/.exec(where);
      const byUrl = /^\(url,like,https:\/\/([^~]+)~\)~or\(url,like,http:\/\/([^~]+)~\)$/.exec(where);
      const records = (options.phishstats ?? []).filter((record) =>
        byHost ? record.host === byHost[1] : byUrl ? record.url.startsWith(`https://${byUrl[1]}`) || record.url.startsWith(`http://${byUrl[2]}`) : false,
      );
      return json(records.map((record, index) => ({ id: 1000 + index, score: null, ...record })));
    }
    if (url.startsWith(radarEndpoint)) {
      const domain = new URL(url).pathname.split("/").at(-1) ?? "";
      const ranked = options.radar?.[domain];
      if (!ranked) {
        return json({ success: false, errors: [{ code: 404, message: "Not Found" }] }, 404);
      }
      return json({
        success: true,
        result: {
          details_0: { categories: (ranked.categories ?? ["Technology"]).map((name, index) => ({ id: index, name, superCategoryId: 0 })), ...(ranked.bucket ? { bucket: ranked.bucket } : {}), ...(ranked.rank ? { rank: ranked.rank } : {}) },
          meta: { dateRange: [{ startTime: "2026-09-28T00:00:00Z", endTime: "2026-10-05T00:00:00Z" }] },
        },
      });
    }
    if (url.startsWith(discordInviteEndpoint)) {
      if (options.discordStatus) {
        return json({ message: "You are being rate limited.", retry_after: 1, global: false }, options.discordStatus);
      }
      const code = decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
      const server = options.discord?.[code];
      if (!server) {
        return json({ message: "Unknown Invite", code: 10006 }, 404);
      }
      if (server.groupChat) {
        return json({ type: 1, code, channel: { id: "1", type: 3, name: "group" }, approximate_member_count: 3 });
      }
      const created = now.getTime() - (server.createdDaysAgo ?? 1500) * 86_400_000;
      const id = (BigInt(created - discordEpoch) << 22n).toString();
      return json({
        type: 0,
        code,
        guild: { id, name: server.name ?? "Friendly Gamers", features: server.features ?? ["COMMUNITY"], description: null },
        approximate_member_count: server.members ?? 120,
        approximate_presence_count: 10,
      });
    }
    if (url === bitlyExpandEndpoint) {
      if (options.bitlyStatus) {
        return json({ message: "FORBIDDEN" }, options.bitlyStatus);
      }
      const id = (JSON.parse(body) as { bitlink_id?: string }).bitlink_id ?? "";
      const target = options.shortLinks?.[id];
      return target && target !== "missing" ? json({ link: `https://${id}`, id, long_url: target, long_urls: [target], created_at: "2026-10-01T00:00:00+0000" }) : json({ message: "NOT_FOUND" }, 404);
    }
    if (url.startsWith(isgdEndpoints["is.gd"]) || url.startsWith(isgdEndpoints["v.gd"])) {
      const parsed = new URL(url);
      const target = options.shortLinks?.[`${parsed.hostname}/${parsed.searchParams.get("shorturl") ?? ""}`];
      if (target === "disabled") {
        return json({ errorcode: 2, errormessage: "The requested shortened URL has been disabled." });
      }
      return target && target !== "missing" ? json({ url: target }) : json({ errorcode: 1, errormessage: "Sorry, the link you accessed doesn't exist on our service." });
    }
    if (url.startsWith(steamApiBase)) {
      if (options.steamStatus) {
        return new Response("<html><body>Forbidden</body></html>", { status: options.steamStatus, headers: { "Content-Type": "text/html" } });
      }
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/ResolveVanityURL/v1/")) {
        const steamid = options.steamVanity?.[parsed.searchParams.get("vanityurl") ?? ""];
        return json({ response: steamid ? { steamid, success: 1 } : { success: 42, message: "No match" } });
      }
      const ids = (parsed.searchParams.get("steamids") ?? "").split(",").filter((id) => options.steam?.[id]);
      if (parsed.pathname.endsWith("/GetPlayerBans/v1/")) {
        return json({
          players: ids.map((id) => {
            const account = options.steam![id]!;
            return {
              SteamId: id,
              CommunityBanned: account.communityBanned ?? false,
              VACBanned: (account.vacBans ?? 0) > 0,
              NumberOfVACBans: account.vacBans ?? 0,
              DaysSinceLastBan: 0,
              NumberOfGameBans: account.gameBans ?? 0,
              EconomyBan: account.economyBan ?? "none",
            };
          }),
        });
      }
      if (parsed.pathname.endsWith("/GetPlayerSummaries/v2/")) {
        return json({
          response: {
            players: ids.map((id) => {
              const account = options.steam![id]!;
              const visibility = account.visibility ?? 3;
              return {
                steamid: id,
                communityvisibilitystate: visibility,
                profilestate: 1,
                personaname: account.name ?? "Player",
                profileurl: `https://steamcommunity.com/profiles/${id}/`,
                ...(visibility === 3 ? { timecreated: Math.floor((now.getTime() - (account.createdDaysAgo ?? 2000) * 86_400_000) / 1000) } : {}),
              };
            }),
          },
        });
      }
    }
    if (url.startsWith(modrinthApi)) {
      if (options.modrinthStatus) {
        return json({ error: "unavailable" }, options.modrinthStatus);
      }
      const path = url.slice(modrinthApi.length);
      const file = /^version_file\/([0-9a-f]{40})\?algorithm=sha1$/.exec(path);
      if (file) {
        const found = options.modrinthFiles?.[file[1]!];
        return found
          ? json({ id: "VersionA", project_id: found.project, version_number: found.version, date_published: found.published ?? "2026-01-15T12:00:00.000000Z", status: found.status ?? "listed", changelog: "Fixes", files: [] })
          : json({ error: "not_found" }, 404);
      }
      const project = /^project\/([^/?]+)$/.exec(path);
      if (project) {
        const wanted = decodeURIComponent(project[1]!);
        const found = options.modrinthProjects?.find((entry) => entry.id === wanted || entry.slug === wanted);
        return found ? json({ id: found.id, slug: found.slug, title: found.title, downloads: found.downloads, project_type: found.type ?? "mod", status: found.status ?? "approved", body: "A mod." }) : json({ error: "not_found" }, 404);
      }
      if (path === "version_files") {
        const hashes = (JSON.parse(body) as { hashes: string[] }).hashes;
        return json(Object.fromEntries(hashes.filter((hash) => options.modrinthFiles?.[hash]).map((hash) => [hash, { project_id: options.modrinthFiles![hash]!.project }])));
      }
    }
    if (url.includes("challenges.cloudflare.com")) {
      return json(options.turnstile ?? { success: true, hostname: "scamcam.kevinle.tech", action: "scan" });
    }
    return json({ error: "unexpected request" }, 404);
  };
  return { fetcher, requests };
}

export const allowAllBudgets = async () => true;

export function listsOf(entries: Partial<Record<ListName, string[]>>, asked: string[][] = [], syncedAt = Math.floor(Date.now() / 1000)): DomainListLookup {
  return {
    async lookup(requested: string[]): Promise<DomainListResults> {
      asked.push(requested);
      return new Map(
        Object.entries(entries).map(([list, names]) => [list as ListName, { status: "ok" as const, listed: new Set(requested.filter((name) => names!.includes(name))), syncedAt }]),
      );
    },
  };
}

export function listOf(names: string[], asked: string[][] = []): DomainListLookup {
  return listsOf({ phishing_database: names }, asked);
}

export function listInState(status: "stale" | "not_configured" | "unavailable"): DomainListLookup {
  return { lookup: async () => new Map([["phishing_database", { status }]]) };
}

export interface FakeDnsEntry {
  dbl?: string;
  zrd?: string;
  rcode?: number;
}

export function fakeSpamhaus(entries: Record<string, FakeDnsEntry>, asked: string[][] = [], down = false): DnsTransport {
  return {
    async resolve(names: string[]): Promise<DnsAnswer[]> {
      asked.push(names);
      if (down) {
        return names.map(() => ({ status: "failed" }));
      }
      return names.map((name): DnsAnswer => {
        const match = /^(.+)\.([a-z0-9]+)\.(dbl|zrd)\.dq\.spamhaus\.net$/.exec(name);
        const entry = match ? entries[match[1]!] : undefined;
        if (entry?.rcode !== undefined) {
          return { status: "answered", rcode: entry.rcode, addresses: [] };
        }
        const address = match?.[3] === "dbl" ? entry?.dbl : entry?.zrd;
        return address ? { status: "answered", rcode: 0, addresses: [address] } : { status: "answered", rcode: 3, addresses: [] };
      });
    },
  };
}
