export const domainListShardCount = 1024;
export const domainListKeyBytes = 8;
export const domainListKeepSeconds = 10 * 24 * 60 * 60;

export const domainListNames = ["phishing_database", "metamask", "scamsniffer", "phishdestroy", "scam_links", "cert_polska"] as const;

export type DomainListName = (typeof domainListNames)[number];

export interface DomainListDetails {
  source: string;
  url: string;
  title: string;
  about: string;
  staleAfterDays: number;
  alertAfterDays: number;
}

export const domainListDetails: Record<DomainListName, DomainListDetails> = {
  phishing_database: {
    source: "Phishing.Database (community list)",
    url: "https://github.com/Phishing-Database/Phishing.Database",
    title: "Phishing.Database lists {name} as a phishing site",
    about: "Phishing.Database is a free community list of phishing sites.",
    staleAfterDays: 7,
    alertAfterDays: 2,
  },
  metamask: {
    source: "MetaMask phishing list",
    url: "https://github.com/MetaMask/eth-phishing-detect",
    title: "MetaMask's phishing list includes {name}",
    about: "MetaMask's security team keeps this list of sites that steal crypto wallets.",
    staleAfterDays: 7,
    alertAfterDays: 2,
  },
  scamsniffer: {
    source: "ScamSniffer scam database",
    url: "https://github.com/scamsniffer/scam-database",
    title: "ScamSniffer lists {name} as a crypto scam site",
    about: "ScamSniffer tracks wallet drainers and other crypto scam sites. Its public copy runs about a week behind.",
    staleAfterDays: 7,
    alertAfterDays: 2,
  },
  phishdestroy: {
    source: "PhishDestroy list",
    url: "https://github.com/phishdestroy/destroylist",
    title: "PhishDestroy lists {name} as a phishing or scam site",
    about: "PhishDestroy is a community project that reports and lists phishing and scam sites.",
    staleAfterDays: 7,
    alertAfterDays: 2,
  },
  scam_links: {
    source: "Discord and Steam scam links (DevSpen)",
    url: "https://github.com/DevSpen/scam-links",
    title: "A Discord and Steam scam list includes {name}",
    about: "This public-domain list collects fake Nitro, Steam, and other scam links seen on Discord.",
    staleAfterDays: 365,
    alertAfterDays: 180,
  },
  cert_polska: {
    source: "CERT Polska warning list",
    url: "https://cert.pl/en/warning-list/",
    title: "CERT Polska lists {name} as a dangerous site",
    about: "CERT Polska, Poland's national security team, keeps this official list of dangerous sites.",
    staleAfterDays: 3,
    alertAfterDays: 2,
  },
};

export type DomainListResult =
  | { status: "ok"; listed: Set<string>; syncedAt: number }
  | { status: "stale" }
  | { status: "not_configured" }
  | { status: "unavailable" };

export type DomainListResults = Map<DomainListName, DomainListResult>;

export interface DomainListLookup {
  lookup(names: string[]): Promise<DomainListResults>;
}

const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;
const ipv4Pattern = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function normalizeListEntry(line: string): string | null {
  const entry = line.trim().toLowerCase().replace(/\.$/, "");
  if (entry === "" || entry.startsWith("#") || entry.startsWith("!")) {
    return null;
  }
  return hostnamePattern.test(entry) || ipv4Pattern.test(entry) ? entry : null;
}

export async function domainListKey(name: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name));
  return new Uint8Array(digest, 0, domainListKeyBytes);
}

export function shardOf(key: Uint8Array): number {
  return (key[0]! << 2) | (key[1]! >> 6);
}

function compareKeys(left: Uint8Array, leftOffset: number, right: Uint8Array): number {
  for (let index = 0; index < domainListKeyBytes; index += 1) {
    const difference = left[leftOffset + index]! - right[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function shardContains(shard: Uint8Array, key: Uint8Array): boolean {
  let low = 0;
  let high = Math.floor(shard.length / domainListKeyBytes) - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const order = compareKeys(shard, middle * domainListKeyBytes, key);
    if (order === 0) {
      return true;
    }
    if (order < 0) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return false;
}

export async function buildShards(names: Iterable<string>): Promise<Uint8Array[]> {
  const buckets: Uint8Array[][] = Array.from({ length: domainListShardCount }, () => []);
  const unique = [...new Set(names)];
  const batch = 2000;
  for (let start = 0; start < unique.length; start += batch) {
    const keys = await Promise.all(unique.slice(start, start + batch).map(domainListKey));
    for (const key of keys) {
      buckets[shardOf(key)]!.push(key);
    }
  }
  return buckets.map((keys) => {
    keys.sort((a, b) => compareKeys(a, 0, b));
    const shard = new Uint8Array(keys.length * domainListKeyBytes);
    let length = 0;
    for (const key of keys) {
      if (length > 0 && compareKeys(shard, length - domainListKeyBytes, key) === 0) {
        continue;
      }
      shard.set(key, length);
      length += domainListKeyBytes;
    }
    return shard.slice(0, length);
  });
}

export function candidateNames(hostname: string, registrableDomain: string | null): string[] {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!registrableDomain || (host !== registrableDomain && !host.endsWith(`.${registrableDomain}`))) {
    return [host];
  }
  const names: string[] = [];
  let current = host;
  while (current.length >= registrableDomain.length) {
    names.push(current);
    if (current === registrableDomain) {
      break;
    }
    current = current.slice(current.indexOf(".") + 1);
  }
  return names;
}
