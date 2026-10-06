export const domainListShardCount = 1024;
export const domainListKeyBytes = 8;
export const domainListStaleAfterSeconds = 3 * 24 * 60 * 60;
export const domainListKeepSeconds = 7 * 24 * 60 * 60;

export type DomainListName = "phishing_database";

export type DomainListResult =
  | { status: "ok"; listed: Set<string>; syncedAt: number }
  | { status: "stale" }
  | { status: "not_configured" }
  | { status: "unavailable" };

export interface DomainListLookup {
  lookup(names: string[]): Promise<DomainListResult>;
}

const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

export function normalizeListEntry(line: string): string | null {
  const entry = line.trim().toLowerCase().replace(/\.$/, "");
  if (entry === "" || entry.startsWith("#") || entry.startsWith("!")) {
    return null;
  }
  return hostnamePattern.test(entry) ? entry : null;
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
