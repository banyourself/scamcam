import { isRangeBody } from "../shared/passwords";
import { cacheKey, sharedLoad, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedBytes } from "./limited-body";

export const pwnedPasswordsEndpoint = "https://api.pwnedpasswords.com/range/";
export const scamcamUserAgent = "ScamCam (https://scamcam.kevinle.tech)";
export const passwordRangeCacheSeconds = 24 * 60 * 60;
export const maxExtraPadding = 200;
const maxRangeBytes = 512 * 1024;

interface StoredRange {
  v: 1;
  expiresAt: number;
  body: string;
}

function isStoredRange(value: unknown, now: number): value is StoredRange {
  const stored = value as StoredRange | null;
  return typeof stored === "object" && stored !== null && stored.v === 1 && typeof stored.body === "string" && typeof stored.expiresAt === "number" && stored.expiresAt > now;
}

export async function fetchPasswordRange(prefix: string, fetcher: typeof fetch): Promise<string | null> {
  const timer = deadline(4000);
  try {
    const response = await fetcher(`${pwnedPasswordsEndpoint}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": scamcamUserAgent, Accept: "text/plain" },
      signal: timer.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const body = new TextDecoder().decode(await readLimitedBytes(response, maxRangeBytes));
    return isRangeBody(body) ? body : null;
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export async function passwordRange(prefix: string, options: { fetcher: typeof fetch; lookups: Lookups }): Promise<string | null> {
  const { lookups } = options;
  const key = await cacheKey("password-range", prefix);
  const stored = await lookups.cache.get(key).catch(() => undefined);
  if (isStoredRange(stored, lookups.clock())) {
    return stored.body;
  }
  return sharedLoad(lookups, key, async () => {
    const body = await fetchPasswordRange(prefix, options.fetcher);
    if (body) {
      const entry: StoredRange = { v: 1, expiresAt: lookups.clock() + passwordRangeCacheSeconds * 1000, body };
      await lookups.cache.put(key, entry, passwordRangeCacheSeconds).catch(() => undefined);
    }
    return body;
  });
}

export function withPadding(body: string, random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = (bytes) => crypto.getRandomValues(bytes)): string {
  const extra = random(new Uint8Array(2));
  const count = ((extra[0]! << 8) | extra[1]!) % (maxExtraPadding + 1);
  if (count === 0) {
    return body;
  }
  const bytes = random(new Uint8Array(count * 18));
  const lines: string[] = [];
  for (let line = 0; line < count; line += 1) {
    let hex = "";
    for (const byte of bytes.subarray(line * 18, line * 18 + 18)) {
      hex += byte.toString(16).padStart(2, "0");
    }
    lines.push(`${hex.slice(0, 35).toUpperCase()}:0`);
  }
  const separator = body.endsWith("\n") ? "" : "\r\n";
  return `${body}${separator}${lines.join("\r\n")}`;
}
