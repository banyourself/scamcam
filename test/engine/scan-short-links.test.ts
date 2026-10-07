import { describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { scanContent, type ScanOptions } from "../../src/engine/scan";
import { bitlyExpandEndpoint, isgdEndpoints, shortLinkRef } from "../../src/engine/short-links";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { allowAllBudgets, fakeNetwork, type FakeNetworkOptions } from "./fake-network";

const now = new Date("2026-10-07T12:00:00.000Z");
const bitlyToken = "bitly-test-token-value";

function scanner(network: FakeNetworkOptions = {}, extra: Partial<ScanOptions> = {}) {
  const fake = fakeNetwork({ now, ...network });
  const scan: ScanOptions = { fetcher: fake.fetcher, takeBudget: allowAllBudgets, now, extendedLookups: true, bitlyToken, ...extra };
  return { fake, scan };
}

const isExpansion = (url: string) => url === bitlyExpandEndpoint || url.startsWith(isgdEndpoints["is.gd"]) || url.startsWith(isgdEndpoints["v.gd"]);

describe("reading short links", () => {
  it("knows Bitly, is.gd, and v.gd codes and nothing else", () => {
    expect(shortLinkRef("bit.ly", "/3AbC-x_9")).toEqual({ service: "bitly", host: "bit.ly", code: "3AbC-x_9" });
    expect(shortLinkRef("j.mp", "/abc")).toEqual({ service: "bitly", host: "j.mp", code: "abc" });
    expect(shortLinkRef("is.gd", "/xyz12/")).toEqual({ service: "isgd", host: "is.gd", code: "xyz12" });
    expect(shortLinkRef("v.gd", "/q")).toEqual({ service: "isgd", host: "v.gd", code: "q" });
    expect(shortLinkRef("bit.ly", "/a/b")).toBeNull();
    expect(shortLinkRef("bit.ly", "/")).toBeNull();
    expect(shortLinkRef("tinyurl.com", "/abc")).toBeNull();
  });
});

describe("short links in scans", () => {
  it("asks Bitly where a link goes, checks that address, and never opens either one", async () => {
    const { scan, fake } = scanner({ shortLinks: { "bit.ly/3Free": "https://steamcommunlty.example/tradeoffer/new/?partner=1" }, registeredDaysAgo: 3 });
    const report = await scanContent("check this trade https://bit.ly/3Free", scan);
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(report.level).toBe("high_risk");
    expect(report.evidence.find((item) => item.id === "expanded-bit.ly-3Free")).toMatchObject({
      signal: "neutral",
      title: "Bitly says this short link goes to steamcommunlty.example",
      source: { name: "Bitly link expansion", url: "https://dev.bitly.com/" },
    });
    expect(report.evidence.some((item) => item.id.startsWith("shortener-"))).toBe(false);
    const bitly = fake.requests.find((request) => request.url === bitlyExpandEndpoint);
    expect(JSON.parse(bitly!.body)).toEqual({ bitlink_id: "bit.ly/3Free" });
    expect(bitly!.headers.get("Authorization")).toBe(`Bearer ${bitlyToken}`);
    expect(fake.requests.some((request) => request.url.startsWith("https://bit.ly") || request.url.startsWith("https://steamcommunlty.example"))).toBe(false);
    expect(JSON.stringify(report)).not.toContain(bitlyToken);
  });

  it("expands is.gd and v.gd links without a key, and follows a redirect wrapper behind them", async () => {
    const { scan } = scanner({ shortLinks: { "is.gd/abc": "https://www.google.com/url?q=https://free-robux-now.example/claim", "v.gd/xyz": "https://www.minecraft.net/en-us" } }, { bitlyToken: undefined });
    const report = await scanContent("is.gd/abc and v.gd/xyz", scan);
    expect(report.evidence.map((item) => item.title)).toEqual(expect.arrayContaining(["is.gd says this short link goes to www.google.com"]));
    expect(report.evidence.some((item) => item.title.includes("free-robux-now.example"))).toBe(true);
    expect(report.notChecked.some((item) => item.name === "is.gd link expansion")).toBe(false);
  });

  it("warns when is.gd disabled a link, and notes one that no longer exists", async () => {
    const disabled = await scanContent("https://is.gd/bad1", scanner({ shortLinks: { "is.gd/bad1": "disabled" } }).scan);
    expect(disabled.evidence.find((item) => item.id === "short-disabled-is.gd-bad1")).toMatchObject({ signal: "raises_risk", title: "is.gd has disabled this short link" });
    const missing = await scanContent("https://bit.ly/gone", scanner().scan);
    expect(missing.evidence.find((item) => item.id === "short-missing-bit.ly-gone")?.title).toBe("This short link does not exist anymore");
  });

  it("says when Bitly is not connected or did not answer, and keeps the short link warning", async () => {
    const missing = await scanContent("https://bit.ly/abc", scanner({}, { bitlyToken: undefined }).scan);
    expect(missing.notChecked).toContainEqual({ name: "Bitly link expansion", reason: "not_configured" });
    expect(missing.evidence.some((item) => item.id.startsWith("shortener-"))).toBe(true);
    const down = await scanContent("https://bit.ly/abc", scanner({ bitlyStatus: 503 }).scan);
    expect(down.notChecked).toContainEqual({ name: "Bitly link expansion", reason: "unavailable" });
  });

  it("expands at most two links, only in the scanner, and remembers answers", async () => {
    const inline = scanner({ shortLinks: { "is.gd/a": "https://example.org/" } }, { extendedLookups: false });
    await scanContent("is.gd/a", inline.scan);
    expect(inline.fake.requests.some((request) => isExpansion(request.url))).toBe(false);
    const lookups = memoryLookups();
    const { scan, fake } = scanner({ shortLinks: { "is.gd/a": "https://example.org/", "is.gd/b": "https://example.net/", "is.gd/c": "https://example.com/" } }, { lookups });
    await scanContent("is.gd/a is.gd/b is.gd/c is.gd/a", scan);
    expect(fake.requests.filter((request) => isExpansion(request.url))).toHaveLength(2);
    await scanContent("is.gd/a is.gd/b", scan);
    expect(fake.requests.filter((request) => isExpansion(request.url))).toHaveLength(2);
  });
});
