import { describe, expect, it } from "vitest";
import type { DomainListLookup } from "../../src/engine/domain-list";
import { scanContent, type ScanOptions } from "../../src/engine/scan";
import { allowAllBudgets, fakeNetwork, listsOf } from "./fake-network";

const now = new Date("2026-10-06T20:45:00.000Z");
const walmart =
  '17605550182 Deposited a new message:\n"This notification relates to an HP Specter X 360 14 inch order for approximately $999. Open your Walmart account through the official app or website to review the purchase details. Please call us back or press 1 to speak with a Walmart customer support representative."\nClick here: 14695550147 to listen to full voice message.';

function options(extra: Partial<ScanOptions> = {}) {
  const fake = fakeNetwork({ now });
  return { fake, scan: { fetcher: fake.fetcher, takeBudget: allowAllBudgets, now, ...extra } satisfies ScanOptions };
}

describe("phone numbers in messages", () => {
  it("rates a fake order voicemail as high risk and notes the number reported to the FTC, without sending or showing it", async () => {
    const asked: string[][] = [];
    const { scan, fake } = options({ scamLists: listsOf({ phishing_database: [], ftc_dnc: ["+14695550147"] }, asked, Math.floor(now.getTime() / 1000) - 3600) });
    const report = await scanContent(walmart, scan);
    expect(report.level).toBe("high_risk");
    expect(report.summary).toBe("This matches the fake order or voicemail callback scam.");
    expect(report.evidence.map((item) => item.id)).toEqual(expect.arrayContaining(["message-fake-voicemail", "message-fake-order-callback", "message-company-callback", "ftc-dnc"]));
    expect(report.evidence.find((item) => item.id === "ftc-dnc")).toMatchObject({
      signal: "raises_risk",
      title: "A phone number in this message was reported to the FTC for unwanted calls",
      source: { name: "FTC Do Not Call reports", url: "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data" },
    });
    expect(report.recommendations[0]).toBe("Do not reply, call any number in it, or send money, codes, or files.");
    expect(report.recommendations.some((tip) => tip.startsWith("Do not call the number in the message."))).toBe(true);
    expect(report.recommendations.join(" ")).not.toContain("Do not open the link");
    expect(asked.flat()).toEqual(expect.arrayContaining(["+17605550182", "+14695550147"]));
    const everything = JSON.stringify(report) + JSON.stringify(fake.requests);
    for (const digits of ["7605550182", "4695550147", "555-0147"]) {
      expect(everything).not.toContain(digits);
    }
    expect(report.subject.display.startsWith("[number hidden] Deposited a new message")).toBe(true);
  });

  it("still catches the scam from its wording when the number is not on the list", async () => {
    const report = await scanContent(walmart, options({ scamLists: listsOf({ phishing_database: [], ftc_dnc: [] }) }).scan);
    expect(report.level).toBe("high_risk");
    expect(report.evidence.some((item) => item.id === "ftc-dnc")).toBe(false);
    expect(report.notChecked.some((item) => item.name === "FTC Do Not Call reports")).toBe(false);
  });

  it("says when the phone list is not connected or out of date, and stays quiet when there is no number", async () => {
    const missing = await scanContent("call me at 714-555-0199", options({ scamLists: listsOf({ phishing_database: [] }) }).scan);
    expect(missing.notChecked).toContainEqual({ name: "FTC Do Not Call reports", reason: "not_configured" });
    const stale: DomainListLookup = { lookup: async () => new Map([["ftc_dnc", { status: "stale" }]]) };
    expect((await scanContent("call me at 714-555-0199", options({ scamLists: stale }).scan)).notChecked).toContainEqual({ name: "FTC Do Not Call reports", reason: "out_of_date" });
    const quiet = await scanContent("gg wp, see you tomorrow", options({ scamLists: listsOf({ phishing_database: [] }) }).scan);
    expect(quiet.notChecked.some((item) => item.name === "FTC Do Not Call reports")).toBe(false);
  });

  it("adds FCC complaints as a second, smaller warning when the FTC also has reports", async () => {
    const both = await scanContent("hey it's me, my new number is 469-555-0147", options({ scamLists: listsOf({ phishing_database: [], ftc_dnc: ["+14695550147"], fcc_complaints: ["+14695550147"] }) }).scan);
    expect(both.evidence.find((item) => item.id === "fcc-complaints")).toMatchObject({
      signal: "raises_risk",
      title: "A phone number in this message was named in complaints to the FCC about unwanted calls",
      source: { name: "FCC consumer complaints", url: "https://opendata.fcc.gov/Consumer/CGB-Consumer-Complaints-Data/3xyp-aqkj" },
    });
    expect(["unknown", "suspicious"]).toContain(both.level);
    const only = await scanContent("call me back at 469-555-0147", options({ scamLists: listsOf({ phishing_database: [], ftc_dnc: [], fcc_complaints: ["+14695550147"] }) }).scan);
    expect(only.evidence.some((item) => item.id === "fcc-complaints")).toBe(true);
    expect(only.evidence.some((item) => item.id === "ftc-dnc")).toBe(false);
    expect(JSON.stringify(both) + JSON.stringify(only)).not.toContain("4695550147");
    const missing = await scanContent("call me at 714-555-0199", options({ scamLists: listsOf({ phishing_database: [], ftc_dnc: [] }) }).scan);
    expect(missing.notChecked).toContainEqual({ name: "FCC consumer complaints", reason: "not_configured" });
  });

  it("counts a reported number as one warning sign, not proof", async () => {
    const report = await scanContent("hey it's me, my new number is 469-555-0147", options({ scamLists: listsOf({ phishing_database: [], ftc_dnc: ["+14695550147"] }) }).scan);
    expect(report.evidence.some((item) => item.id === "ftc-dnc")).toBe(true);
    expect(["unknown", "suspicious"]).toContain(report.level);
  });
});

describe("wallet addresses in messages", () => {
  const wallet = `0x${"7538fd1e30".repeat(4)}`;

  it("warns about a wallet on ScamSniffer's list as a drainer and sends it nowhere", async () => {
    const asked: string[][] = [];
    const { scan, fake } = options({ scamLists: listsOf({ phishing_database: [], scamsniffer_wallets: [wallet] }, asked) });
    const report = await scanContent(`To claim your airdrop, send 0.01 ETH for gas to ${wallet.toUpperCase().replace("0X", "0x")}`, scan);
    expect(report.evidence.find((item) => item.id === "scam-wallet")).toMatchObject({
      signal: "raises_risk",
      title: "A wallet address in this message is on ScamSniffer's scam list",
      source: { name: "ScamSniffer scam wallets", url: "https://github.com/scamsniffer/scam-database" },
    });
    expect(["suspicious", "high_risk"]).toContain(report.level);
    expect(report.recommendations).toContain("Never connect your wallet or sign anything on a site someone sent you. Check the project's official account yourself.");
    expect(asked.flat()).toContain(wallet);
    expect(fake.requests).toEqual([]);
  });

  it("stays quiet about wallets that are not listed, and says when the wallet list is not connected", async () => {
    const clean = await scanContent(`my address is ${wallet}`, options({ scamLists: listsOf({ phishing_database: [], scamsniffer_wallets: [] }) }).scan);
    expect(clean.evidence.some((item) => item.id === "scam-wallet")).toBe(false);
    expect(clean.level).toBe("no_known_threat");
    const missing = await scanContent(`my address is ${wallet}`, options({ scamLists: listsOf({ phishing_database: [] }) }).scan);
    expect(missing.notChecked).toContainEqual({ name: "ScamSniffer scam wallets", reason: "not_configured" });
    const quiet = await scanContent("gg wp", options({ scamLists: listsOf({ phishing_database: [] }) }).scan);
    expect(quiet.notChecked.some((item) => item.name === "ScamSniffer scam wallets")).toBe(false);
  });
});
