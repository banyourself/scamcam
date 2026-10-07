import { recallFromMemory, recordOutcome, rememberInMemory, sourceIsOpen, type Lookups } from "./cache";
import { isDnsName } from "./dns-wire";

export const spamhausSource = "spamhaus";
export const spamhausDblUrl = "https://www.spamhaus.org/blocklists/domain-blocklist/";
export const spamhausZrdUrl = "https://docs.spamhaus.com/datasets/docs/source/10-data-type-documentation/datasets/030-datasets.html#zero-reputation-domains-zrd";
export const spamhausServers = ["a.gns.spamhaus.net", "b.gns.spamhaus.net", "c.gns.spamhaus.net", "d.gns.spamhaus.net", "e.gns.spamhaus.net"];

const keyPattern = /^[A-Za-z0-9]{16,64}$/;
const maxDomainLength = 160;
const memorySeconds = 60;
const nxdomain = 3;

export type DnsFailure = "connect_failed" | "connect_timeout" | "write_failed" | "reply_timeout" | "closed_early" | "malformed";

export type DnsAnswer = { status: "answered"; rcode: number; addresses: string[] } | { status: "failed"; reason?: DnsFailure };

export interface DnsTransport {
  resolve(names: string[]): Promise<DnsAnswer[]>;
}

export type DblKind = "spam" | "phishing" | "malware" | "botnet" | "redirector";

export interface DblListing {
  kind: DblKind;
  abused: boolean;
}

const dblCodes: Record<string, DblListing> = {
  "127.0.1.2": { kind: "spam", abused: false },
  "127.0.1.4": { kind: "phishing", abused: false },
  "127.0.1.5": { kind: "malware", abused: false },
  "127.0.1.6": { kind: "botnet", abused: false },
  "127.0.1.102": { kind: "spam", abused: true },
  "127.0.1.103": { kind: "redirector", abused: true },
  "127.0.1.104": { kind: "phishing", abused: true },
  "127.0.1.105": { kind: "malware", abused: true },
  "127.0.1.106": { kind: "botnet", abused: true },
};

const severity: Record<DblKind, number> = { phishing: 5, malware: 5, botnet: 5, spam: 2, redirector: 1 };

export type SpamhausResult = { status: "ok"; dbl: DblListing | null; zrd: { hoursAgo: number | null } | null } | { status: "unavailable" };

export interface SpamhausOptions {
  key: string;
  transport: DnsTransport;
  lookups: Lookups;
}

export function spamhausKeyIsValid(key: string | undefined): key is string {
  return typeof key === "string" && keyPattern.test(key);
}

function isQueryable(domain: string): boolean {
  return domain.length <= maxDomainLength && isDnsName(domain) && !/^[\d.]+$/.test(domain);
}

function isErrorCode(address: string): boolean {
  return address.startsWith("127.255.255.") || address.endsWith(".255");
}

function dblFrom(answer: DnsAnswer | undefined): DblListing | null | undefined {
  if (answer?.status !== "answered" || (answer.rcode !== 0 && answer.rcode !== nxdomain)) {
    return undefined;
  }
  if (answer.rcode === nxdomain || answer.addresses.length === 0) {
    return null;
  }
  if (answer.addresses.some(isErrorCode)) {
    return undefined;
  }
  const listings = answer.addresses.map((address) => dblCodes[address]).filter((listing): listing is DblListing => Boolean(listing));
  if (listings.length === 0) {
    return undefined;
  }
  return listings.reduce((top, listing) => {
    const rank = severity[listing.kind] - (listing.abused ? 0.5 : 0);
    const topRank = severity[top.kind] - (top.abused ? 0.5 : 0);
    return rank > topRank ? listing : top;
  });
}

function zrdFrom(answer: DnsAnswer | undefined): { hoursAgo: number | null } | null | undefined {
  if (answer?.status !== "answered" || (answer.rcode !== 0 && answer.rcode !== nxdomain)) {
    return undefined;
  }
  if (answer.rcode === nxdomain || answer.addresses.length === 0) {
    return null;
  }
  if (answer.addresses.some(isErrorCode) || !answer.addresses.every((address) => address.startsWith("127.0.2."))) {
    return undefined;
  }
  const hours = Number(answer.addresses[0]!.split(".")[3]);
  return { hoursAgo: hours >= 2 && hours <= 24 ? hours : null };
}

function isResult(value: unknown): value is SpamhausResult {
  return typeof value === "object" && value !== null && (value as SpamhausResult).status === "ok";
}

export async function lookupSpamhaus(domains: string[], options: SpamhausOptions): Promise<Map<string, SpamhausResult>> {
  const results = new Map<string, SpamhausResult>();
  const wanted = [...new Set(domains.map((domain) => domain.toLowerCase()))].filter(isQueryable);
  const missing: string[] = [];
  for (const domain of wanted) {
    const remembered = recallFromMemory(options.lookups, `spamhaus:${domain}`);
    if (isResult(remembered)) {
      results.set(domain, remembered);
    } else {
      missing.push(domain);
    }
  }
  if (missing.length === 0) {
    return results;
  }
  if (!spamhausKeyIsValid(options.key) || !sourceIsOpen(options.lookups, spamhausSource)) {
    for (const domain of missing) {
      results.set(domain, { status: "unavailable" });
    }
    return results;
  }
  const key = options.key.toLowerCase();
  const names = missing.flatMap((domain) => [`${domain}.${key}.dbl.dq.spamhaus.net`, `${domain}.${key}.zrd.dq.spamhaus.net`]);
  const answers = await options.transport.resolve(names).catch((): DnsAnswer[] => []);
  let answered = false;
  missing.forEach((domain, index) => {
    const dbl = dblFrom(answers[index * 2]);
    const zrd = zrdFrom(answers[index * 2 + 1]);
    if (dbl === undefined || zrd === undefined) {
      results.set(domain, { status: "unavailable" });
      return;
    }
    answered = true;
    const result: SpamhausResult = { status: "ok", dbl, zrd };
    rememberInMemory(options.lookups, `spamhaus:${domain}`, result, memorySeconds);
    results.set(domain, result);
  });
  recordOutcome(options.lookups, spamhausSource, answered);
  return results;
}
