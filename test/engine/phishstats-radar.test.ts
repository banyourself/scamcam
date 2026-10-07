import { describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { lookupPhishstats, phishstatsUrl, summarizeRecords } from "../../src/engine/phishstats";
import { isPopular, lookupRadar, radarAnswerFrom } from "../../src/engine/radar";
import { allowAllBudgets, fakeNetwork } from "./fake-network";

const site = { hostname: "login.scam-site.example", registrableDomain: "scam-site.example", privateSuffix: false };
const tenant = { hostname: "free-skins.pages.dev", registrableDomain: "free-skins.pages.dev", privateSuffix: true };

describe("PhishStats lookups", () => {
  it("asks by site for normal domains and by exact host for tenants of shared hosting", () => {
    expect(phishstatsUrl(site)).toBe("https://api.phishstats.info/api/phishing?_where=(host,eq,scam-site.example)&_sort=-id&_size=30");
    expect(phishstatsUrl(tenant)).toBe("https://api.phishstats.info/api/phishing?_where=(url,like,~://free-skins.pages.dev~)&_sort=-id&_size=30");
    for (const hostname of ["a,b.example", "x).example", "x~y.example", "under_score.example", "203.0.113.5"]) {
      expect(phishstatsUrl({ hostname, registrableDomain: hostname, privateSuffix: false }), hostname).toBeNull();
    }
  });

  it("separates reports for this exact host from reports elsewhere on the site", () => {
    const answer = summarizeRecords(
      [
        { url: "https://login.scam-site.example/verify", date: "2026-09-30T10:00:00.000Z", rank_host: null },
        { url: "https://login.scam-site.example/other", date: "2026-10-02T10:00:00.000Z" },
        { url: "https://www.scam-site.example/", date: "2026-08-01T10:00:00.000Z" },
        { url: "https://scam-site.example.attacker.example/", date: "2026-10-01T10:00:00.000Z" },
        { url: "not a url", date: "2026-10-01T10:00:00.000Z" },
        { nothing: true },
      ],
      site,
    );
    expect(answer).toEqual({ status: "ok", exactHost: { reports: 2, latest: "2026-10-02" }, sameSite: { reports: 1, latest: "2026-08-01" }, popular: false });
    expect(summarizeRecords([{ url: "https://away.vk.example/away.php", date: "2026-10-01T00:00:00Z", rank_host: 7854 }], { hostname: "away.vk.example", registrableDomain: "vk.example", privateSuffix: false }).popular).toBe(true);
    expect(summarizeRecords([{ url: "https://other.pages.dev/", date: "2026-10-01T00:00:00Z" }], tenant).sameSite.reports).toBe(0);
  });

  it("sends the key in a header, counts against the daily budget, and caches the answer", async () => {
    const network = fakeNetwork({ phishstats: [{ url: "https://login.scam-site.example/verify", host: "scam-site.example", date: "2026-10-01T00:00:00Z" }] });
    const lookups = memoryLookups();
    let budget = 0;
    const options = { apiKey: "psk_test", fetcher: network.fetcher, lookups, takeBudget: async () => ++budget <= 5 };
    const first = await lookupPhishstats(site, options);
    expect(first.status === "ok" && first.exactHost.reports).toBe(1);
    expect(network.requests).toHaveLength(1);
    expect(network.requests[0]!.headers.get("X-API-Key")).toBe("psk_test");
    expect(network.requests[0]!.url).not.toContain("psk_test");
    await lookupPhishstats(site, options);
    expect(network.requests).toHaveLength(1);
    expect(budget).toBe(1);
    const over = await lookupPhishstats(tenant, { ...options, takeBudget: async () => false });
    expect(over).toEqual({ status: "over_budget" });
  });

  it("reports quota and network errors as not checked", async () => {
    const limited = await lookupPhishstats(site, { apiKey: "psk_test", fetcher: fakeNetwork({ phishstatsStatus: 429 }).fetcher, lookups: memoryLookups(), takeBudget: allowAllBudgets });
    expect(limited).toEqual({ status: "unavailable" });
    const down = await lookupPhishstats(site, { apiKey: "psk_test", fetcher: fakeNetwork({ down: true }).fetcher, lookups: memoryLookups(), takeBudget: allowAllBudgets });
    expect(down).toEqual({ status: "unavailable" });
  });
});

describe("Cloudflare Radar ranking", () => {
  it("reads the rank for the top 100 and the bucket for everything else", () => {
    expect(radarAnswerFrom({ success: true, result: { details_0: { rank: 7, categories: [{ name: "Search Engines" }] } } })).toEqual({ status: "ok", top: 7, warningCategory: false });
    expect(radarAnswerFrom({ success: true, result: { details_0: { bucket: "50000", categories: [] } } })).toEqual({ status: "ok", top: 50_000, warningCategory: false });
    expect(radarAnswerFrom({ success: true, result: { details_0: { bucket: ">1000000" } } })).toEqual({ status: "ok", top: null, warningCategory: false });
    expect(radarAnswerFrom({ success: true, result: { details_0: { bucket: "2000", categories: [{ name: "Phishing" }] } } })?.warningCategory).toBe(true);
    expect(radarAnswerFrom({ success: false })).toBeNull();
    expect(radarAnswerFrom("nonsense")).toBeNull();
  });

  it("counts a site as popular only in the top 100,000 and never with a security category", () => {
    expect(isPopular({ status: "ok", top: 100_000, warningCategory: false })).toBe(true);
    expect(isPopular({ status: "ok", top: 200_000, warningCategory: false })).toBe(false);
    expect(isPopular({ status: "ok", top: 10, warningCategory: true })).toBe(false);
    expect(isPopular({ status: "ok", top: null, warningCategory: false })).toBe(false);
    expect(isPopular({ status: "unavailable" })).toBe(false);
  });

  it("sends the token as a bearer header, treats unranked domains as not popular, and caches for a day", async () => {
    const network = fakeNetwork({ radar: { "popular.example": { bucket: "10000" } } });
    const lookups = memoryLookups();
    const options = { token: "radar-test-token", fetcher: network.fetcher, lookups };
    expect(await lookupRadar("popular.example", options)).toEqual({ status: "ok", top: 10_000, warningCategory: false });
    expect(network.requests[0]!.url).toBe("https://api.cloudflare.com/client/v4/radar/ranking/domain/popular.example?format=json");
    expect(network.requests[0]!.headers.get("Authorization")).toBe("Bearer radar-test-token");
    expect(await lookupRadar("unranked.example", options)).toEqual({ status: "ok", top: null, warningCategory: false });
    await lookupRadar("popular.example", options);
    expect(network.requests).toHaveLength(2);
    expect(await lookupRadar("bad domain", options)).toEqual({ status: "unavailable" });
    expect(await lookupRadar("popular.example", { ...options, token: "", lookups: memoryLookups() })).toEqual({ status: "unavailable" });
  });
});
