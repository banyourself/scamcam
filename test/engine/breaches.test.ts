import { describe, expect, it } from "vitest";
import { breachIndex, compactCatalog, fetchBreachCatalog, hibpBreachesEndpoint } from "../../src/engine/breach-catalog";
import { memoryLookups } from "../../src/engine/cache";
import { fetchPasswordRange, maxExtraPadding, passwordRange, pwnedPasswordsEndpoint, withPadding } from "../../src/engine/pwned-passwords";
import { scanContent } from "../../src/engine/scan";
import type { BreachCatalog } from "../../src/shared/api";
import { isRangeBody, rangeCounts } from "../../src/shared/passwords";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { rawBreach, rawBreachList } from "../fixtures/hibp-breaches";
import { allowAllBudgets, fakeNetwork } from "./fake-network";

const suffix = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";
const range = `003D68EB55068C33ACE09247EE4C639306B:3\r\n${suffix}:52372427\r\n0123456789ABCDEF0123456789ABCDEF012:0\r\n`;
const fetchedAt = new Date("2026-10-08T12:00:00.000Z");

function catalog(): BreachCatalog {
  return compactCatalog(rawBreachList(), fetchedAt)!;
}

describe("Pwned Passwords ranges", () => {
  it("sends only the prefix, asks for padding, and names ScamCam", async () => {
    const fake = fakeNetwork({ passwordRanges: { "5BAA6": range } });
    expect(await fetchPasswordRange("5BAA6", fake.fetcher)).toBe(range);
    expect(fake.requests).toHaveLength(1);
    const request = fake.requests[0]!;
    expect(request.url).toBe(`${pwnedPasswordsEndpoint}5BAA6`);
    expect(request.headers.get("Add-Padding")).toBe("true");
    expect(request.headers.get("User-Agent")).toBe("ScamCam (https://scamcam.kevinle.tech)");
    expect(request.body).toBe("");
  });

  it("refuses answers that are not a range and answers that failed", async () => {
    expect(await fetchPasswordRange("5BAA6", fakeNetwork({ passwordRanges: { "5BAA6": "<html>blocked</html>" } }).fetcher)).toBeNull();
    expect(await fetchPasswordRange("5BAA6", fakeNetwork({ passwordStatus: 503 }).fetcher)).toBeNull();
    expect(await fetchPasswordRange("5BAA6", fakeNetwork({ down: true }).fetcher)).toBeNull();
  });

  it("keeps a range for a day under a hashed key and asks once for answers that arrive together", async () => {
    const fake = fakeNetwork({ passwordRanges: { "5BAA6": range } });
    let now = Date.parse("2026-10-08T00:00:00Z");
    const lookups = memoryLookups(() => now);
    const [first, second] = await Promise.all([passwordRange("5BAA6", { fetcher: fake.fetcher, lookups }), passwordRange("5BAA6", { fetcher: fake.fetcher, lookups })]);
    expect(first).toBe(range);
    expect(second).toBe(range);
    expect(fake.requests).toHaveLength(1);
    now += 23 * 60 * 60 * 1000;
    expect(await passwordRange("5BAA6", { fetcher: fake.fetcher, lookups })).toBe(range);
    expect(fake.requests).toHaveLength(1);
    now += 2 * 60 * 60 * 1000;
    await passwordRange("5BAA6", { fetcher: fake.fetcher, lookups });
    expect(fake.requests).toHaveLength(2);
    expect(lookups.state.memory.size).toBe(0);
  });

  it("does not keep a failed answer", async () => {
    const lookups = memoryLookups();
    expect(await passwordRange("5BAA6", { fetcher: fakeNetwork({ passwordStatus: 500 }).fetcher, lookups })).toBeNull();
    const fake = fakeNetwork({ passwordRanges: { "5BAA6": range } });
    expect(await passwordRange("5BAA6", { fetcher: fake.fetcher, lookups })).toBe(range);
    expect(fake.requests).toHaveLength(1);
  });

  it("adds a random number of zero-count lines that the browser ignores", () => {
    let calls = 0;
    const fixed = (bytes: Uint8Array<ArrayBuffer>) => {
      calls += 1;
      bytes.fill(calls === 1 ? 0 : 171);
      if (calls === 1) {
        bytes[1] = 7;
      }
      return bytes;
    };
    const padded = withPadding(range, fixed);
    expect(padded.startsWith(range)).toBe(true);
    const added = padded.slice(range.length).split("\r\n");
    expect(added).toHaveLength(7);
    expect(added.every((line) => /^[0-9A-F]{35}:0$/.test(line))).toBe(true);
    expect(isRangeBody(padded)).toBe(true);
    expect([...rangeCounts(padded).keys()]).toEqual(["003D68EB55068C33ACE09247EE4C639306B", suffix]);
    const sizes = new Set(Array.from({ length: 20 }, () => withPadding(range).length));
    expect(sizes.size).toBeGreaterThan(1);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(range.length + maxExtraPadding * 39);
  });
});

describe("the breach list", () => {
  it("keeps only what the page needs and marks what is not a breach of the site", () => {
    const compact = catalog();
    expect(compact.fetchedAt).toBe(fetchedAt.toISOString());
    expect(compact.breaches).toHaveLength(117);
    const adobe = compact.breaches.find((entry) => entry.name === "Adobe")!;
    expect(adobe).toEqual({
      name: "Adobe",
      title: "Adobe",
      domain: "adobe.com",
      breachDate: "2013-10-04",
      addedDate: "2020-06-01",
      accounts: 152445165,
      classes: adobe.classes,
      notes: [],
    });
    expect(adobe.classes.map((index) => compact.dataClasses[index])).toEqual(["Email addresses", "Password hints", "Passwords", "Usernames"]);
    expect(compact.breaches.find((entry) => entry.name === "MadeUp")?.notes).toEqual(["unverified", "fabricated"]);
    expect(JSON.stringify(compact)).not.toContain("<a href");
    expect(JSON.stringify(compact)).not.toContain("logos.haveibeenpwned.com");
  });

  it("skips malformed entries and refuses a list that looks cut off", () => {
    const list = [...rawBreachList(), { Name: 5 }, "not a breach", rawBreach({ Name: "BadDate", BreachDate: "soon" })];
    expect(compactCatalog(list, fetchedAt)?.breaches).toHaveLength(117);
    expect(compactCatalog(rawBreachList().slice(0, 50), fetchedAt)).toBeNull();
    expect(compactCatalog({ breaches: [] }, fetchedAt)).toBeNull();
  });

  it("downloads the public list without a key and names ScamCam", async () => {
    const fake = fakeNetwork({ breaches: rawBreachList() });
    const compact = await fetchBreachCatalog(fake.fetcher, fetchedAt);
    expect(compact?.breaches).toHaveLength(117);
    expect(fake.requests.map((request) => request.url)).toEqual([hibpBreachesEndpoint]);
    expect(fake.requests[0]!.headers.get("User-Agent")).toBe("ScamCam (https://scamcam.kevinle.tech)");
    expect(fake.requests[0]!.headers.has("hibp-api-key")).toBe(false);
    expect(await fetchBreachCatalog(fakeNetwork({ breachesStatus: 429 }).fetcher, fetchedAt)).toBeNull();
  });

  it("indexes real breaches of a site by domain, newest first", () => {
    const index = breachIndex(catalog());
    expect(index.get("roblox.com")?.map((entry) => entry.name)).toEqual(["Roblox", "RobloxOld"]);
    expect(index.has("spamlist.example")).toBe(false);
    expect(index.has("madeup.example")).toBe(false);
    expect(index.has("dating.example")).toBe(true);
    expect(index.has("")).toBe(false);
  });
});

describe("breach context in link reports", () => {
  const now = new Date("2026-10-08T12:00:00.000Z");

  it("mentions a known breach of the link's site as context only, crediting Have I Been Pwned", async () => {
    const fake = fakeNetwork({ now });
    const breaches = breachIndex(catalog());
    const plain = await scanContent("https://www.roblox.com/home", { fetcher: fake.fetcher, takeBudget: allowAllBudgets, now });
    const report = await scanContent("https://www.roblox.com/home", { fetcher: fake.fetcher, takeBudget: allowAllBudgets, now, breaches });
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(report.level).toBe(plain.level);
    expect(report.evidence.find((item) => item.id === "breach-roblox.com")).toMatchObject({
      signal: "neutral",
      title: "roblox.com has had 2 known data breaches, the latest in July 2023",
      source: { name: "Have I Been Pwned (known breaches)", url: "https://haveibeenpwned.com/Breach/Roblox" },
    });
    expect(report.evidence.find((item) => item.id === "breach-roblox.com")?.detail).toContain("CC BY 4.0");
  });

  it("names a single breach, skips sites without one, and makes no extra request", async () => {
    const fake = fakeNetwork({ now });
    const breaches = breachIndex(catalog());
    const report = await scanContent("compare https://adobe.com/login with https://quiet-site.example/x", { fetcher: fake.fetcher, takeBudget: allowAllBudgets, now, breaches });
    expect(report.evidence.find((item) => item.id === "breach-adobe.com")?.title).toBe("Adobe had a data breach in October 2013");
    expect(report.evidence.some((item) => item.id === "breach-quiet-site.example")).toBe(false);
    expect(fake.requests.some((request) => request.url.includes("haveibeenpwned"))).toBe(false);
  });

  it("mentions at most two breached sites", async () => {
    const extra = [rawBreach({ Name: "One", Domain: "one.example" }), rawBreach({ Name: "Two", Domain: "two.example" }), rawBreach({ Name: "Three", Domain: "three.example" })];
    const breaches = breachIndex(compactCatalog(rawBreachList(extra), fetchedAt)!);
    const report = await scanContent("https://one.example https://two.example https://three.example", { fetcher: fakeNetwork({ now }).fetcher, takeBudget: allowAllBudgets, now, breaches });
    expect(report.evidence.filter((item) => item.id.startsWith("breach-"))).toHaveLength(2);
  });
});
