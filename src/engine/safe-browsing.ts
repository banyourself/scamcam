import { getDomain } from "tldts";
import { z } from "zod";

export const safeBrowsingEndpoint = "https://safebrowsing.googleapis.com/v5/hashes:search";

function toByteString(text: string): string {
  return String.fromCharCode(...new TextEncoder().encode(text));
}

function fullyUnescape(text: string): string {
  let current = text;
  for (let round = 0; round < 32; round += 1) {
    const next = current.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
    if (next === current) {
      return next;
    }
    current = next;
  }
  return current;
}

function escapeBytes(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    result += code <= 32 || code >= 127 || code === 0x23 || code === 0x25 ? `%${code.toString(16).toUpperCase().padStart(2, "0")}` : text[index];
  }
  return result;
}

function parseIpPart(part: string): number | null {
  if (/^0x[0-9a-f]*$/i.test(part)) {
    return part.length === 2 ? 0 : Number.parseInt(part.slice(2), 16);
  }
  if (/^0[0-7]+$/.test(part)) {
    return Number.parseInt(part.slice(1), 8);
  }
  if (/^(?:0|[1-9][0-9]*)$/.test(part)) {
    return Number(part);
  }
  return null;
}

export function normalizeIpv4(host: string): string | null {
  const parts = host.split(".");
  if (parts.length > 4 || parts.some((part) => part === "")) {
    return null;
  }
  const values = parts.map(parseIpPart);
  if (values.some((value) => value === null)) {
    return null;
  }
  const numbers = values as number[];
  const last = numbers.pop()!;
  if (numbers.some((value) => value > 255) || last >= 256 ** (4 - numbers.length)) {
    return null;
  }
  let address = last;
  numbers.forEach((value, index) => {
    address += value * 256 ** (3 - index);
  });
  return [24, 16, 8, 0].map((shift) => Math.floor(address / 2 ** shift) % 256).join(".");
}

function bytesToUnicodeHost(host: string): string {
  if (!/[\x80-\xff]/.test(host)) {
    return host;
  }
  try {
    const bytes = Uint8Array.from(host, (char) => char.charCodeAt(0));
    const unicode = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return new URL(`http://${unicode}`).hostname;
  } catch {
    return host;
  }
}

function canonicalHost(rawHost: string): string {
  let host = fullyUnescape(rawHost)
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  host = bytesToUnicodeHost(host);
  if (host.startsWith("[")) {
    try {
      const normalized = new URL(`http://${host}`).hostname;
      const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(normalized);
      if (mapped) {
        const high = Number.parseInt(mapped[1]!, 16);
        const low = Number.parseInt(mapped[2]!, 16);
        return [high >> 8, high & 255, low >> 8, low & 255].join(".");
      }
      return normalized;
    } catch {
      return host;
    }
  }
  return normalizeIpv4(host) ?? host;
}

function canonicalPath(rawPath: string): string {
  const path = fullyUnescape(rawPath);
  const segments = path.split("/");
  const kept: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      kept.pop();
      continue;
    }
    kept.push(segment);
  }
  const last = segments[segments.length - 1];
  const trailing = path.endsWith("/") || last === "." || last === "..";
  return `/${kept.join("/")}${trailing && kept.length > 0 ? "/" : ""}`;
}

export function canonicalizeBytes(input: string): string | null {
  let url = input.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "").replace(/[\t\r\n]/g, "");
  const fragment = url.indexOf("#");
  if (fragment >= 0) {
    url = url.slice(0, fragment);
  }
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(url);
  const scheme = schemeMatch ? schemeMatch[1]!.toLowerCase() : "http";
  if (scheme !== "http" && scheme !== "https") {
    return null;
  }
  const rest = schemeMatch ? url.slice(schemeMatch[0].length) : url;
  const authorityEnd = rest.search(/[/?]/);
  let authority = authorityEnd < 0 ? rest : rest.slice(0, authorityEnd);
  let pathAndQuery = authorityEnd < 0 ? "/" : rest.slice(authorityEnd);
  if (pathAndQuery.startsWith("?")) {
    pathAndQuery = `/${pathAndQuery}`;
  }
  const at = authority.lastIndexOf("@");
  if (at >= 0) {
    authority = authority.slice(at + 1);
  }
  const rawHost = authority.startsWith("[") ? authority.slice(0, authority.indexOf("]") + 1) : authority.replace(/:\d*$/, "");
  const host = canonicalHost(rawHost);
  if (!host) {
    return null;
  }
  const queryStart = pathAndQuery.indexOf("?");
  const path = canonicalPath(queryStart < 0 ? pathAndQuery : pathAndQuery.slice(0, queryStart));
  const query = queryStart < 0 ? null : fullyUnescape(pathAndQuery.slice(queryStart + 1));
  return `${scheme}://${escapeBytes(host)}${escapeBytes(path)}${query === null ? "" : `?${escapeBytes(query)}`}`;
}

export function canonicalizeUrl(input: string): string | null {
  return canonicalizeBytes(toByteString(input));
}

function isIpHost(host: string): boolean {
  return host.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

export function hostSuffixes(host: string): string[] {
  if (isIpHost(host)) {
    return [host];
  }
  const labels = host.split(".");
  const domain = getDomain(host);
  const suffixes: string[] = [host];
  if (domain) {
    for (let count = domain.split(".").length; count < labels.length && suffixes.length < 5; count += 1) {
      suffixes.push(labels.slice(-count).join("."));
    }
  } else {
    for (let start = Math.max(1, labels.length - 5); start <= labels.length - 2 && suffixes.length < 5; start += 1) {
      suffixes.push(labels.slice(start).join("."));
    }
  }
  return [...new Set(suffixes)];
}

export function pathPrefixes(path: string, query: string | null): string[] {
  const prefixes: string[] = [];
  if (query !== null) {
    prefixes.push(`${path}?${query}`);
  }
  prefixes.push(path);
  let directory = "/";
  prefixes.push(directory);
  for (const segment of path.split("/").slice(1, -1)) {
    if (prefixes.length >= 6 || directory.split("/").length > 4) {
      break;
    }
    directory += `${segment}/`;
    prefixes.push(directory);
  }
  return [...new Set(prefixes)];
}

export function urlExpressions(canonical: string): string[] {
  const match = /^[a-z]+:\/\/([^/]*)(\/[^?]*)(?:\?(.*))?$/.exec(canonical);
  if (!match) {
    return [];
  }
  const [, host, path, query] = match;
  const hosts = hostSuffixes(host!);
  const paths = pathPrefixes(path!, query ?? null);
  return [...new Set(hosts.flatMap((candidate) => paths.map((prefix) => `${candidate}${prefix}`)))];
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(text: string): Promise<Uint8Array> {
  const bytes = Uint8Array.from(text, (char) => char.charCodeAt(0));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

const SearchResponseSchema = z.object({
  fullHashes: z
    .array(
      z.object({
        fullHash: z.string(),
        fullHashDetails: z.array(z.object({ threatType: z.string(), attributes: z.array(z.string()).optional() })).optional(),
      }),
    )
    .optional(),
  cacheDuration: z.string().optional(),
});

const ignoredAttributes = new Set(["CANARY", "FRAME_ONLY", "THREAT_ATTRIBUTE_UNSPECIFIED"]);

export type SafeBrowsingResult =
  | { status: "ok"; threats: Map<string, string[]>; cacheSeconds: number }
  | { status: "unavailable" };

export async function searchSafeBrowsing(links: string[], apiKey: string, fetcher: typeof fetch): Promise<SafeBrowsingResult> {
  const hashesByLink = new Map<string, string[]>();
  const prefixes = new Set<string>();
  for (const link of links) {
    const canonical = canonicalizeUrl(link);
    if (!canonical) {
      continue;
    }
    const hashes: string[] = [];
    for (const expression of urlExpressions(canonical)) {
      const digest = await sha256(expression);
      hashes.push(hex(digest));
      prefixes.add(toBase64(digest.slice(0, 4)));
    }
    hashesByLink.set(link, hashes);
  }
  if (prefixes.size === 0) {
    return { status: "ok", threats: new Map(), cacheSeconds: 0 };
  }
  const query = new URLSearchParams({ key: apiKey });
  for (const prefix of [...prefixes].slice(0, 1000)) {
    query.append("hashPrefixes", prefix);
  }
  let payload: unknown;
  try {
    const response = await fetcher(`${safeBrowsingEndpoint}?${query}`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) {
      return { status: "unavailable" };
    }
    payload = await response.json();
  } catch {
    return { status: "unavailable" };
  }
  const parsed = SearchResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return { status: "unavailable" };
  }
  const threatsByHash = new Map<string, string[]>();
  for (const entry of parsed.data.fullHashes ?? []) {
    let decoded: string;
    try {
      decoded = hex(Uint8Array.from(atob(entry.fullHash), (char) => char.charCodeAt(0)));
    } catch {
      continue;
    }
    const types = (entry.fullHashDetails ?? [])
      .filter((detail) => !(detail.attributes ?? []).some((attribute) => ignoredAttributes.has(attribute)))
      .map((detail) => detail.threatType);
    if (types.length > 0) {
      threatsByHash.set(decoded, types);
    }
  }
  const threats = new Map<string, string[]>();
  for (const [link, hashes] of hashesByLink) {
    const found = [...new Set(hashes.flatMap((hash) => threatsByHash.get(hash) ?? []))];
    if (found.length > 0) {
      threats.set(link, found);
    }
  }
  const cacheSeconds = Number.parseFloat((parsed.data.cacheDuration ?? "0s").replace(/s$/, "")) || 0;
  return { status: "ok", threats, cacheSeconds };
}

export const threatDescriptions: Record<string, string> = {
  SOCIAL_ENGINEERING: "a suspected deceptive or phishing site",
  MALWARE: "a site that may install harmful software",
  UNWANTED_SOFTWARE: "a site that may offer unwanted software",
  POTENTIALLY_HARMFUL_APPLICATION: "a site that may offer potentially harmful apps",
};
