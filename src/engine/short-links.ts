import { z } from "zod";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";

export const bitlyExpandEndpoint = "https://api-ssl.bitly.com/v4/expand";
export const isgdEndpoints = { "is.gd": "https://is.gd/forward.php", "v.gd": "https://v.gd/forward.php" } as const;
export const bitlyHomePage = "https://dev.bitly.com/";
export const isgdHomePage = "https://is.gd/apilookupreference.php";
export const maxExpandedLinks = 2;
const cacheSeconds = 6 * 60 * 60;
const maxResponseBytes = 32 * 1024;
const codePattern = /^[A-Za-z0-9_-]{1,64}$/;
const bitlyHosts = new Set(["bit.ly", "www.bit.ly", "j.mp"]);

export type ShortLinkService = "bitly" | "isgd";

export interface ShortLinkRef {
  service: ShortLinkService;
  host: "bit.ly" | "j.mp" | "is.gd" | "v.gd";
  code: string;
}

const BitlySchema = z.object({ long_url: z.string().max(4096) });
const IsgdSchema = z.union([z.object({ url: z.string().max(4096) }), z.object({ errorcode: z.number().int(), errormessage: z.string().max(500).optional() })]);
const AnswerSchema = z.union([
  z.object({ status: z.literal("ok"), target: z.string().max(4096) }),
  z.object({ status: z.literal("missing") }),
  z.object({ status: z.literal("disabled") }),
]);

export type ShortLinkAnswer = z.infer<typeof AnswerSchema>;
export type ShortLinkResult = ShortLinkAnswer | { status: "unavailable" } | { status: "not_configured" };

export interface ShortLinkOptions {
  fetcher: typeof fetch;
  lookups: Lookups;
  bitlyToken?: string | undefined;
}

function isAnswer(value: unknown): value is ShortLinkAnswer {
  return AnswerSchema.safeParse(value).success;
}

export function shortLinkRef(hostname: string | null, pathname: string): ShortLinkRef | null {
  const code = /^\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (!hostname || !code || !codePattern.test(code)) {
    return null;
  }
  if (bitlyHosts.has(hostname)) {
    return { service: "bitly", host: hostname === "j.mp" ? "j.mp" : "bit.ly", code };
  }
  if (hostname === "is.gd" || hostname === "v.gd") {
    return { service: "isgd", host: hostname, code };
  }
  return null;
}

function webTarget(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

async function queryBitly(ref: ShortLinkRef, token: string, fetcher: typeof fetch): Promise<ShortLinkAnswer | null> {
  const timer = deadline(3000);
  try {
    const response = await fetcher(bitlyExpandEndpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ bitlink_id: `${ref.host}/${ref.code}` }),
      signal: timer.signal,
    });
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "missing" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const parsed = BitlySchema.safeParse(await readLimitedJson(response, maxResponseBytes));
    const target = parsed.success ? webTarget(parsed.data.long_url) : null;
    return target ? { status: "ok", target } : null;
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

async function queryIsgd(ref: ShortLinkRef, fetcher: typeof fetch): Promise<ShortLinkAnswer | null> {
  const timer = deadline(3000);
  try {
    const endpoint = ref.host === "v.gd" ? isgdEndpoints["v.gd"] : isgdEndpoints["is.gd"];
    const response = await fetcher(`${endpoint}?${new URLSearchParams({ format: "json", shorturl: ref.code }).toString()}`, {
      headers: { Accept: "application/json", "User-Agent": "ScamCam (https://scamcam.kevinle.tech)" },
      signal: timer.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const parsed = IsgdSchema.safeParse(await readLimitedJson(response, maxResponseBytes));
    if (!parsed.success) {
      return null;
    }
    if ("url" in parsed.data) {
      const target = webTarget(parsed.data.url);
      return target ? { status: "ok", target } : null;
    }
    return parsed.data.errorcode === 1 ? { status: "missing" } : parsed.data.errorcode === 2 ? { status: "disabled" } : null;
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export async function expandShortLink(ref: ShortLinkRef, options: ShortLinkOptions): Promise<ShortLinkResult> {
  if (ref.service === "bitly" && !options.bitlyToken) {
    return { status: "not_configured" };
  }
  const { lookups } = options;
  const key = await cacheKey("short-link", `${ref.host}/${ref.code}`);
  const hit = await readCached(lookups, key, isAnswer);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<ShortLinkResult> => {
    if (!sourceIsOpen(lookups, ref.service)) {
      return { status: "unavailable" };
    }
    const answer = ref.service === "bitly" ? await queryBitly(ref, options.bitlyToken!, options.fetcher) : await queryIsgd(ref, options.fetcher);
    recordOutcome(lookups, ref.service, answer !== null);
    if (!answer) {
      return { status: "unavailable" };
    }
    await writeCached(lookups, key, answer, cacheSeconds);
    return answer;
  });
}
