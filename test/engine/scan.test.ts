import { describe, expect, it } from "vitest";
import { canonicalizeUrl, urlExpressions } from "../../src/engine/safe-browsing";
import { scanContent, type ScanOptions } from "../../src/engine/scan";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { allowAllBudgets, fakeNetwork, listInState, listOf, type FakeNetworkOptions } from "./fake-network";

const now = new Date("2026-10-05T12:00:00.000Z");

function options(network: FakeNetworkOptions = {}, extra: Partial<ScanOptions> = {}) {
  const fake = fakeNetwork({ now, ...network });
  return { fake, scan: { fetcher: fake.fetcher, takeBudget: allowAllBudgets, now, ...extra } satisfies ScanOptions };
}

async function hashOf(link: string): Promise<string> {
  const expression = urlExpressions(canonicalizeUrl(link)!)[0]!;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expression)));
  return btoa(String.fromCharCode(...digest));
}

describe("scanContent", () => {
  it("returns reports that match the public schema", async () => {
    const { scan } = options();
    const report = await scanContent("check steamcommunlty.example/tradeoffer/new", scan);
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(report.caseNumber).toMatch(/^SC-261005-[0-9A-F]{4}$/);
  });

  it("trusts official links and says which sources were not connected", async () => {
    const { scan, fake } = options();
    const report = await scanContent("https://steamcommunity.com/tradeoffer/new/?partner=1", scan);
    expect(report.level).toBe("no_known_threat");
    expect(report.confidence).toBe("high");
    expect(report.summary).toBe("This link goes to Steam's official website.");
    expect(report.subject.kind).toBe("url");
    expect(report.notChecked).toEqual([{ name: "Google Safe Browsing", reason: "not_configured" }]);
    expect(fake.requests).toEqual([]);
  });

  it("rates a fresh look-alike trade page as high risk with registry evidence", async () => {
    const { scan } = options({ registeredDaysAgo: 2 });
    const report = await scanContent("steamcommunlty.example/tradeoffer/new/?partner=1", scan);
    expect(report.level).toBe("high_risk");
    expect(report.confidence).toBe("high");
    expect(report.summary).toBe("This looks like a fake Steam site.");
    expect(report.evidence.map((item) => item.source.name)).toEqual(expect.arrayContaining(["ScamCam domain check", "RDAP registry data"]));
    expect(report.evidence.some((item) => item.title.includes("registered 2 days ago"))).toBe(true);
  });

  it("flags a scam script with no links", async () => {
    const { scan, fake } = options();
    const report = await scanContent("hey sorry I accidentally reported your account, talk to the discord staff to fix it", scan);
    expect(report.level).toBe("high_risk");
    expect(report.summary).toBe("This matches the \"I accidentally reported you\" scam.");
    expect(report.notChecked).toEqual([]);
    expect(fake.requests).toEqual([]);
  });

  it("calls a harmless message without links no known threat, with low confidence", async () => {
    const { scan } = options();
    const report = await scanContent("gg wp, want to play again tomorrow?", scan);
    expect(report.level).toBe("no_known_threat");
    expect(report.confidence).toBe("low");
  });

  it("stays unknown for an ordinary domain when Safe Browsing is not connected", async () => {
    const { scan } = options();
    const report = await scanContent("https://www.example.org/news", scan);
    expect(report.level).toBe("unknown");
  });

  it("calls a clean, old domain no known threat when Safe Browsing has no warning", async () => {
    const { scan } = options({ safeBrowsing: () => ({}) }, { safeBrowsingKey: "key" });
    const report = await scanContent("https://www.example.org/news", scan);
    expect(report.level).toBe("no_known_threat");
    expect(report.confidence).toBe("medium");
    expect(report.usesGoogleSafeBrowsing).toBe(true);
    expect(report.evidence.some((item) => item.title === "No warning from Google Safe Browsing")).toBe(true);
  });

  it("treats a Safe Browsing match as high risk, never as confirmed", async () => {
    const link = "https://phish.example/login";
    const fullHash = await hashOf(link);
    const { scan } = options({ safeBrowsing: () => ({ fullHashes: [{ fullHash, fullHashDetails: [{ threatType: "SOCIAL_ENGINEERING" }] }] }) }, { safeBrowsingKey: "key" });
    const report = await scanContent(link, scan);
    expect(report.level).toBe("high_risk");
    expect(report.evidence[0]!.title).toBe("Google Safe Browsing warns this is a suspected deceptive or phishing site");
    expect(report.usesGoogleSafeBrowsing).toBe(true);
  });

  it("confirms only when URLhaus lists the link as online", async () => {
    const { scan } = options(
      { urlhaus: { query_status: "ok", url_count: "3", urls: [{ url: "https://malware.example/payload.exe", url_status: "online", threat: "malware_download" }] } },
      { urlhausKey: "key" },
    );
    const report = await scanContent("https://malware.example/payload.exe", scan);
    expect(report.level).toBe("confirmed_malicious");
    expect(report.confidence).toBe("high");
    expect(report.evidence[0]!.source.name).toBe("URLhaus (abuse.ch)");
  });

  it("does not let URLhaus reports on shared hosts condemn every link", async () => {
    const { scan } = options(
      { urlhaus: { query_status: "ok", url_count: "900", urls: [{ url: "https://foo.pages.dev/other.exe", url_status: "online" }] } },
      { urlhausKey: "key" },
    );
    const report = await scanContent("https://foo.pages.dev/", scan);
    expect(report.level).not.toBe("confirmed_malicious");
    expect(report.evidence.some((item) => item.title === "Other links on this service have spread malware")).toBe(true);
  });

  it("skips quota-limited sources when the daily budget is used up", async () => {
    const { scan } = options({}, { safeBrowsingKey: "key", urlhausKey: "key", takeBudget: async () => false });
    const report = await scanContent("https://www.example.org/news", scan);
    expect(report.notChecked).toEqual(
      expect.arrayContaining([
        { name: "Google Safe Browsing", reason: "over_budget" },
        { name: "URLhaus (abuse.ch)", reason: "over_budget" },
      ]),
    );
  });

  it("keeps working when every outside source is down", async () => {
    const { scan } = options({ down: true }, { safeBrowsingKey: "key", urlhausKey: "key", phishingList: listInState("unavailable") });
    const report = await scanContent("steamcommunlty.example/tradeoffer/new", scan);
    expect(report.level).toBe("high_risk");
    expect(report.notChecked.map((entry) => entry.reason)).toEqual(["unavailable", "unavailable", "unavailable", "unavailable", "unavailable"]);
  });

  it("never sends the full link or the message to outside services", async () => {
    const { scan, fake } = options({ safeBrowsing: () => ({}) }, { safeBrowsingKey: "key", urlhausKey: "key" });
    await scanContent("my friend said log in at https://steam-gift.example/tradeoffer/new/?partner=987654321&token=SECRETTOKEN", scan);
    expect(fake.requests.length).toBeGreaterThan(0);
    for (const request of fake.requests) {
      const sent = `${request.url} ${request.body}`;
      expect(sent).not.toContain("tradeoffer");
      expect(sent).not.toContain("SECRETTOKEN");
      expect(sent).not.toContain("my friend");
    }
  });

  it("hides personal details in the displayed subject", async () => {
    const { scan } = options();
    const report = await scanContent("email me at kid@example.com or call 714 555 0199", scan);
    expect(report.subject.display).not.toContain("kid@example.com");
    expect(report.subject.display).toContain("[email hidden]");
  });

  it("lowers confidence when an official link carries a dangerous file", async () => {
    const { scan } = options();
    const report = await scanContent("https://cdn.discordapp.com/attachments/1/2/FreeNitro.exe", scan);
    expect(report.level).toBe("suspicious");
    expect(report.evidence.some((item) => item.title === "Sources disagree")).toBe(true);
  });
});

describe("Phishing.Database list in scans", () => {
  it("raises a strong warning for a listed site but never confirms it", async () => {
    const { scan } = options({}, { phishingList: listOf(["cheap-skins.example"]) });
    const report = await scanContent("https://cheap-skins.example/", scan);
    expect(report.level).toBe("suspicious");
    expect(report.evidence[0]!.title).toBe("Phishing.Database lists cheap-skins.example as a phishing site");
    expect(report.evidence[0]!.source).toEqual({ name: "Phishing.Database (community list)", url: "https://github.com/Phishing-Database/Phishing.Database" });
  });

  it("adds up with a look-alike name to high risk", async () => {
    const { scan } = options({}, { phishingList: listOf(["steamcommunlty.example"]) });
    const report = await scanContent("https://steamcommunlty.example/tradeoffer/new", scan);
    expect(report.level).toBe("high_risk");
    expect(report.evidence.some((item) => item.title.startsWith("Phishing.Database lists"))).toBe(true);
  });

  it("matches a listed parent domain but not a sibling of a listed name", async () => {
    const asked: string[][] = [];
    const { scan } = options({}, { phishingList: listOf(["evil-trade.example", "a.shared-host.example"], asked) });
    const parent = await scanContent("https://login.evil-trade.example/verify", scan);
    expect(parent.evidence.some((item) => item.title === "Phishing.Database lists evil-trade.example as a phishing site")).toBe(true);
    const sibling = await scanContent("https://b.shared-host.example/", scan);
    expect(sibling.evidence.some((item) => item.title.includes("Phishing.Database"))).toBe(false);
    expect(asked[0]).toEqual(["login.evil-trade.example", "evil-trade.example"]);
  });

  it("treats a listed shortener as context, not as a warning about this link", async () => {
    const { scan } = options({}, { phishingList: listOf(["bit.ly"]) });
    const report = await scanContent("https://bit.ly/3abcde", scan);
    const listed = report.evidence.find((item) => item.title.includes("community phishing list"));
    expect(listed?.signal).toBe("neutral");
  });

  it("never looks up official sites", async () => {
    const asked: string[][] = [];
    const { scan } = options({}, { phishingList: listOf(["steamcommunity.com"], asked) });
    const report = await scanContent("https://steamcommunity.com/tradeoffer/new/?partner=1", scan);
    expect(asked).toEqual([]);
    expect(report.level).toBe("no_known_threat");
  });

  it("says when the list is out of date or not connected", async () => {
    const stale = await scanContent("https://cheap-skins.example/", options({}, { phishingList: listInState("stale") }).scan);
    expect(stale.notChecked).toContainEqual({ name: "Phishing.Database (community list)", reason: "out_of_date" });
    const missing = await scanContent("https://cheap-skins.example/", options().scan);
    expect(missing.notChecked).toContainEqual({ name: "Phishing.Database (community list)", reason: "not_configured" });
  });
});

