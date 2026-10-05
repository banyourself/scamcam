import { z } from "zod";

export const urlhausHostEndpoint = "https://urlhaus-api.abuse.ch/v1/host/";

const HostSchema = z.object({
  query_status: z.string(),
  urlhaus_reference: z.string().optional(),
  url_count: z.union([z.string(), z.number()]).optional(),
  urls: z
    .array(z.object({ url: z.string(), url_status: z.string().optional(), threat: z.string().nullable().optional() }))
    .optional(),
});

export type UrlhausResult =
  | { status: "ok"; listed: false }
  | { status: "ok"; listed: true; reference: string | null; total: number; onlineUrls: string[]; threats: string[] }
  | { status: "unavailable" };

export async function lookupUrlhausHost(host: string, authKey: string, fetcher: typeof fetch): Promise<UrlhausResult> {
  try {
    const response = await fetcher(urlhausHostEndpoint, {
      method: "POST",
      headers: { "Auth-Key": authKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ host }).toString(),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      return { status: "unavailable" };
    }
    const parsed = HostSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { status: "unavailable" };
    }
    if (parsed.data.query_status === "no_results") {
      return { status: "ok", listed: false };
    }
    if (parsed.data.query_status !== "ok") {
      return { status: "unavailable" };
    }
    const urls = parsed.data.urls ?? [];
    return {
      status: "ok",
      listed: true,
      reference: parsed.data.urlhaus_reference ?? null,
      total: Number(parsed.data.url_count ?? urls.length) || urls.length,
      onlineUrls: urls.filter((entry) => entry.url_status === "online").map((entry) => entry.url),
      threats: [...new Set(urls.map((entry) => entry.threat).filter((threat): threat is string => Boolean(threat)))],
    };
  } catch {
    return { status: "unavailable" };
  }
}

export function sameUrl(a: string, b: string): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return normalize(a) === normalize(b);
}
