import { afterEach, describe, expect, it, vi } from "vitest";
import type { DnsAnswer, DnsTransport } from "../../src/engine/spamhaus";
import { describeError, watchedFetcher, watchedTransport } from "../../src/worker/scanner";

const names = ["phish.example.testkeyplaceholder.dbl.dq.spamhaus.net", "phish.example.testkeyplaceholder.zrd.dq.spamhaus.net"];

function alertsFrom(log: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>).filter((entry) => entry.event === "alert");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider alerts", () => {
  it("raises one Spamhaus alert every ten minutes at most, without the query names that hold the key", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let now = 0;
    const answers: DnsAnswer[] = [{ status: "answered", rcode: 2, addresses: [] }];
    const failing: DnsTransport = { resolve: async () => answers };
    const watched = watchedTransport(failing, () => now);
    await watched.resolve(names);
    await watched.resolve(names);
    now += 10 * 60 * 1000;
    answers[0] = { status: "answered", rcode: 0, addresses: ["127.255.255.255"] };
    await watched.resolve(names);
    now += 10 * 60 * 1000;
    answers[0] = { status: "failed", reason: "http_error", detail: "HTTP 503" };
    answers[1] = { status: "answered", rcode: 3, addresses: [] };
    await watched.resolve(names);
    expect(alertsFrom(log).map((entry) => [entry.alert, entry.reason, entry.answered, entry.asked, entry.detail])).toEqual([
      ["spamhaus_unavailable", "rcode_2", 1, 1, undefined],
      ["spamhaus_unavailable", "code_255", 1, 1, undefined],
      ["spamhaus_unavailable", "http_error", 1, 2, "HTTP 503"],
    ]);
    expect(log.mock.calls.join(" ")).not.toContain("testkey");
  });

  it("keeps anything that looks like a key out of error details", () => {
    expect(describeError(new Error("lookup phish.example.Kq7xZ0pLmN3vB8wR2tY5.dbl failed"))).toBe("Error: lookup phish.example.[hidden].dbl failed");
    expect(describeError(new TypeError("Network connection lost."))).toBe("TypeError: Network connection lost.");
    expect(describeError("")).toBeUndefined();
  });

  it("logs PhishStats and Radar errors with only the status and their message, at most every ten minutes", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let now = 0;
    const answers: Record<string, () => Response> = {
      "api.phishstats.info": () => new Response(JSON.stringify({ error: "Invalid API key" }), { status: 401 }),
      "api.cloudflare.com": () => new Response(JSON.stringify({ success: false, errors: [{ code: 404, message: "Not Found" }] }), { status: 404 }),
      "cloudflare-dns.com": () => new Response("{}", { status: 503 }),
    };
    const fetcher = watchedFetcher(async (input) => answers[new URL(String(input)).hostname]!(), () => now);
    const first = await fetcher("https://api.phishstats.info/api/phishing?_where=(host,eq,private-domain.example)&_sort=-id&_size=30");
    expect(first.status).toBe(401);
    expect(await first.json()).toEqual({ error: "Invalid API key" });
    await fetcher("https://api.phishstats.info/api/phishing?_where=(host,eq,private-domain.example)");
    await fetcher("https://api.cloudflare.com/client/v4/radar/ranking/domain/private-domain.example?format=json");
    await fetcher("https://cloudflare-dns.com/dns-query?name=private-domain.example&type=A");
    now += 10 * 60 * 1000;
    answers["api.cloudflare.com"] = () => new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }), { status: 403 });
    await fetcher("https://api.cloudflare.com/client/v4/radar/ranking/domain/private-domain.example?format=json");
    const failing = watchedFetcher(async () => {
      throw new TypeError("fetch failed");
    }, () => now);
    await expect(failing("https://api.phishstats.info/api/phishing")).rejects.toThrow("fetch failed");
    expect(alertsFrom(log).map(({ alert, status, detail, reason }) => ({ alert, status, detail, reason }))).toEqual([
      { alert: "phishstats_unavailable", status: 401, detail: "Invalid API key", reason: undefined },
      { alert: "radar_unavailable", status: 403, detail: "Authentication error", reason: undefined },
      { alert: "phishstats_unavailable", status: undefined, detail: undefined, reason: "TypeError" },
    ]);
    expect(log.mock.calls.join(" ")).not.toContain("private-domain");
  });

  it("logs abuse.ch errors and timeouts without the host that was looked up or the key", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher = watchedFetcher(async (input, init) => {
      const host = new URL(String(input)).hostname;
      if (host === "threatfox-api.abuse.ch") {
        throw new DOMException("The operation timed out", "TimeoutError");
      }
      expect(new Headers(init?.headers).get("Auth-Key")).toBe("abusechkeyvalue");
      return new Response(JSON.stringify({ error: "Service temporarily unavailable" }), { status: 503 });
    });
    await fetcher("https://urlhaus-api.abuse.ch/v1/host/", { method: "POST", headers: { "Auth-Key": "abusechkeyvalue" }, body: "host=private-host.example" });
    await expect(fetcher("https://threatfox-api.abuse.ch/api/v1/", { method: "POST", body: "private-host.example" })).rejects.toThrow("timed out");
    expect(alertsFrom(log).map(({ alert, status, detail, reason }) => ({ alert, status, detail, reason }))).toEqual([
      { alert: "urlhaus_unavailable", status: 503, detail: "Service temporarily unavailable", reason: undefined },
      { alert: "threatfox_unavailable", status: undefined, detail: undefined, reason: "TimeoutError" },
    ]);
    const logged = log.mock.calls.join(" ");
    expect(logged).not.toContain("private-host");
    expect(logged).not.toContain("abusechkeyvalue");
  });

  it("logs Discord and Steam errors without the invite, the profile, or the Steam key, and stays quiet about missing invites", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const answers: Record<string, () => Response> = {
      "discord.com": () => new Response(JSON.stringify({ message: "Unknown Invite", code: 10006 }), { status: 404 }),
      "api.steampowered.com": () => new Response("<html><body>Forbidden</body></html>", { status: 403 }),
    };
    const fetcher = watchedFetcher(async (input) => answers[new URL(String(input)).hostname]!());
    await fetcher("https://discord.com/api/v10/invites/secretcode?with_counts=true");
    await fetcher("https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=hiddensteamkeyvalue&vanityurl=privateprofile");
    answers["discord.com"] = () => new Response(JSON.stringify({ message: "You are being rate limited.", retry_after: 1 }), { status: 429 });
    await fetcher("https://discord.com/api/v10/invites/secretcode?with_counts=true");
    expect(alertsFrom(log).map(({ alert, status, detail }) => ({ alert, status, detail }))).toEqual([
      { alert: "steam_unavailable", status: 403, detail: undefined },
      { alert: "discord_unavailable", status: 429, detail: "You are being rate limited." },
    ]);
    const logged = log.mock.calls.join(" ");
    for (const secret of ["secretcode", "hiddensteamkeyvalue", "privateprofile"]) {
      expect(logged).not.toContain(secret);
    }
  });
});
