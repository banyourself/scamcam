import { describe, expect, it } from "vitest";
import { scanContent, type ScanOptions } from "../../src/engine/scan";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { allowAllBudgets, fakeNetwork, fakeSpamhaus, type FakeDnsEntry, type FakeNetworkOptions } from "./fake-network";

const now = new Date("2026-10-05T12:00:00.000Z");
const key = "testkey0123456789abcdefgh";

function scanner(network: FakeNetworkOptions = {}, dns: Record<string, FakeDnsEntry> = {}, extra: Partial<ScanOptions> = {}, asked: string[][] = []) {
  const fake = fakeNetwork({ now, ...network });
  const scan: ScanOptions = {
    fetcher: fake.fetcher,
    takeBudget: allowAllBudgets,
    now,
    extendedLookups: true,
    spamhaus: { key, transport: fakeSpamhaus(dns, asked) },
    phishstatsKey: "psk_test",
    radarToken: "radar-test-token",
    ...extra,
  };
  return { fake, scan, asked };
}

describe("Spamhaus in scans", () => {
  it("confirms a domain Spamhaus lists for phishing and names the source", async () => {
    const { scan } = scanner({}, { "steam-gift-claim.example": { dbl: "127.0.1.4" } });
    const report = await scanContent("https://login.steam-gift-claim.example/sign-in", scan);
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(report.level).toBe("confirmed_malicious");
    expect(report.evidence[0]).toMatchObject({
      id: "spamhaus-steam-gift-claim.example",
      signal: "raises_risk",
      title: "Spamhaus lists steam-gift-claim.example as a phishing domain",
      source: { name: "Spamhaus DBL and ZRD", url: "https://www.spamhaus.org/blocklists/domain-blocklist/" },
    });
  });

  it("warns without confirming about spam domains and real sites that are being abused", async () => {
    const spam = await scanContent("https://cheap-skins.example/", scanner({}, { "cheap-skins.example": { dbl: "127.0.1.2" } }).scan);
    expect(spam.level).not.toBe("confirmed_malicious");
    expect(spam.evidence.find((item) => item.id === "spamhaus-cheap-skins.example")?.signal).toBe("raises_risk");
    const abused = await scanContent("https://old-school-club.example/wp-content/login.php", scanner({}, { "old-school-club.example": { dbl: "127.0.1.104" } }).scan);
    expect(abused.level).not.toBe("confirmed_malicious");
    expect(abused.evidence.find((item) => item.id === "spamhaus-abused-old-school-club.example")?.title).toBe(
      "Spamhaus says old-school-club.example is a real site being abused for phishing",
    );
  });

  it("adds the first-seen warning only when the registry has not already shown the domain is new", async () => {
    const old = await scanContent("https://fresh-drop.example/", scanner({ registeredDaysAgo: 4000 }, { "fresh-drop.example": { zrd: "127.0.2.3" } }).scan);
    expect(old.evidence.find((item) => item.id === "spamhaus-new-fresh-drop.example")?.title).toBe("Spamhaus first saw fresh-drop.example about 3 hours ago");
    const fresh = await scanContent("https://fresh-drop.example/", scanner({ registeredDaysAgo: 0 }, { "fresh-drop.example": { zrd: "127.0.2.3" } }).scan);
    expect(fresh.evidence.some((item) => item.id === "rdap-new-fresh-drop.example")).toBe(true);
    expect(fresh.evidence.some((item) => item.id === "spamhaus-new-fresh-drop.example")).toBe(false);
  });

  it("sends Spamhaus only the domain, never the path, login, or query", async () => {
    const asked: string[][] = [];
    await scanContent("https://user:secret@deep.sub.example-site.example/path/private-token?code=987654321", scanner({}, {}, {}, asked).scan);
    expect(asked).toEqual([[`example-site.example.${key}.dbl.dq.spamhaus.net`, `example-site.example.${key}.zrd.dq.spamhaus.net`]]);
  });

  it("says when Spamhaus is not connected or did not answer", async () => {
    const missing = await scanContent("https://some-site.example/", scanner({}, {}, { spamhaus: undefined }).scan);
    expect(missing.notChecked).toContainEqual({ name: "Spamhaus DBL and ZRD", reason: "not_configured" });
    const down = await scanContent("https://some-site.example/", scanner({}, {}, { spamhaus: { key, transport: fakeSpamhaus({}, [], true) } }).scan);
    expect(down.notChecked).toContainEqual({ name: "Spamhaus DBL and ZRD", reason: "unavailable" });
  });
});

describe("PhishStats in scans", () => {
  const reported = [{ url: "https://login.scam-site.example/verify", host: "scam-site.example", date: "2026-10-01T08:00:00.000Z" }];

  it("raises a strong warning for a recent report on the same host", async () => {
    const report = await scanContent("https://login.scam-site.example/account", scanner({ phishstats: reported }).scan);
    expect(report.evidence.find((item) => item.id === "phishstats-login.scam-site.example")).toMatchObject({
      signal: "raises_risk",
      title: "PhishStats has phishing reports for login.scam-site.example",
      source: { name: "PhishStats", url: "https://phishstats.info/" },
    });
    expect(report.evidence.find((item) => item.id === "phishstats-login.scam-site.example")?.detail).toContain("the latest on October 1, 2026");
  });

  it("treats reports on a popular service as context, and other pages on a site as a smaller warning", async () => {
    const popular = await scanContent("https://forms.big-service.example/x", scanner({ phishstats: [{ url: "https://forms.big-service.example/y", host: "big-service.example", date: "2026-10-01T00:00:00Z", rank_host: 900 }] }).scan);
    expect(popular.evidence.find((item) => item.id === "phishstats-shared-forms.big-service.example")?.signal).toBe("neutral");
    const sibling = await scanContent("https://www.scam-site.example/", scanner({ phishstats: reported }).scan);
    expect(sibling.evidence.find((item) => item.id === "phishstats-site-scam-site.example")?.signal).toBe("raises_risk");
  });

  it("says when PhishStats is not connected, over its daily limit, or down", async () => {
    expect((await scanContent("https://some-site.example/", scanner({}, {}, { phishstatsKey: undefined }).scan)).notChecked).toContainEqual({ name: "PhishStats", reason: "not_configured" });
    const overBudget = scanner({}, {}, { takeBudget: async (provider) => provider !== "phishstats" });
    expect((await scanContent("https://some-site.example/", overBudget.scan)).notChecked).toContainEqual({ name: "PhishStats", reason: "over_budget" });
    expect(overBudget.fake.requests.some((request) => request.url.includes("phishstats"))).toBe(false);
    expect((await scanContent("https://some-site.example/", scanner({ phishstatsStatus: 429 }).scan)).notChecked).toContainEqual({ name: "PhishStats", reason: "unavailable" });
  });
});

describe("Cloudflare Radar in scans", () => {
  const message = "is this discord thing legit? https://popular-site.win/article";

  it("softens only the small warnings on a very popular site and credits Cloudflare Radar", async () => {
    const plain = await scanContent(message, scanner().scan);
    expect(plain.evidence.some((item) => item.id === "risky-tld-popular-site.win")).toBe(true);
    expect(plain.evidence.some((item) => item.id === "brand-mismatch-popular-site.win")).toBe(true);
    const ranked = await scanContent(message, scanner({ radar: { "popular-site.win": { bucket: "5000" } } }).scan);
    expect(ranked.evidence.some((item) => item.id === "risky-tld-popular-site.win")).toBe(false);
    expect(ranked.evidence.some((item) => item.id === "brand-mismatch-popular-site.win")).toBe(false);
    const credit = ranked.evidence.find((item) => item.id === "radar-popular-popular-site.win");
    expect(credit).toMatchObject({ signal: "lowers_risk", title: "popular-site.win is one of the most visited sites (in the top 5,000 on Cloudflare Radar)" });
    expect(credit?.detail).toContain("CC BY-NC 4.0");
  });

  it("never lets popularity outweigh a real listing", async () => {
    const report = await scanContent(
      "https://popular-site.win/login",
      scanner({ radar: { "popular-site.win": { rank: 50 } } }, { "popular-site.win": { dbl: "127.0.1.4" } }).scan,
    );
    expect(report.level).toBe("confirmed_malicious");
  });

  it("does not rank shared hosting or sites with a security category", async () => {
    const tenant = scanner({ radar: { "free-skins.pages.dev": { rank: 3 } } });
    await scanContent("https://free-skins.pages.dev/claim", tenant.scan);
    expect(tenant.fake.requests.some((request) => request.url.includes("/radar/"))).toBe(false);
    const flagged = await scanContent(message, scanner({ radar: { "popular-site.win": { bucket: "5000", categories: ["Phishing"] } } }).scan);
    expect(flagged.evidence.some((item) => item.id === "risky-tld-popular-site.win")).toBe(true);
  });
});

describe("the Worker fallback", () => {
  it("skips Spamhaus, PhishStats, and Radar to stay inside the request limits", async () => {
    const asked: string[][] = [];
    const { scan, fake } = scanner({}, {}, { extendedLookups: false }, asked);
    const report = await scanContent("https://some-site.example/", scan);
    expect(asked).toEqual([]);
    expect(fake.requests.some((request) => request.url.includes("phishstats") || request.url.includes("/radar/"))).toBe(false);
    expect(report.notChecked.some((item) => ["Spamhaus DBL and ZRD", "PhishStats"].includes(item.name))).toBe(false);
  });
});
