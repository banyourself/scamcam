import { dohEndpoint } from "../../src/engine/dns";
import { rdapBootstrapUrl } from "../../src/engine/rdap";
import { safeBrowsingEndpoint } from "../../src/engine/safe-browsing";
import { urlhausHostEndpoint } from "../../src/engine/urlhaus";

export interface FakeNetworkOptions {
  registeredDaysAgo?: number | "missing";
  rdapStatus?: string[];
  dnsStatus?: number;
  safeBrowsing?: (prefixes: string[]) => unknown;
  urlhaus?: unknown;
  turnstile?: unknown;
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
    if (url.startsWith(dohEndpoint)) {
      return json({ Status: options.dnsStatus ?? 0, Answer: [{ type: 1, data: "203.0.113.10" }] });
    }
    if (url.startsWith(safeBrowsingEndpoint)) {
      const prefixes = new URL(url).searchParams.getAll("hashPrefixes");
      return json(options.safeBrowsing ? options.safeBrowsing(prefixes) : {});
    }
    if (url === urlhausHostEndpoint) {
      return json(options.urlhaus ?? { query_status: "no_results" });
    }
    if (url.includes("challenges.cloudflare.com")) {
      return json(options.turnstile ?? { success: true, hostname: "scamcam.kevinle.tech" });
    }
    return json({ error: "unexpected request" }, 404);
  };
  return { fetcher, requests };
}

export const allowAllBudgets = async () => true;
