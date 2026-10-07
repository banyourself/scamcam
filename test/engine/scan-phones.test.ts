import { describe, expect, it } from "vitest";
import type { DomainListLookup } from "../../src/engine/domain-list";
import { scanContent, type ScanOptions } from "../../src/engine/scan";
import { allowAllBudgets, fakeNetwork, listsOf } from "./fake-network";

const now = new Date("2026-10-06T20:45:00.000Z");
const walmart =
  '17607662951 Deposited a new message:\n"This notification relates to an HP Specter X 360 14 inch order for approximately $999. Open your Walmart account through the official app or website to review the purchase details. Please call us back or press 1 to speak with a Walmart customer support representative."\nClick here: 14699825001 to listen to full voice message.';

function options(extra: Partial<ScanOptions> = {}) {
  const fake = fakeNetwork({ now });
  return { fake, scan: { fetcher: fake.fetcher, takeBudget: allowAllBudgets, now, ...extra } satisfies ScanOptions };
}

describe("phone numbers in messages", () => {
  it("rates a fake order voicemail as high risk and notes the number reported to the FTC, without sending or showing it", async () => {
    const asked: string[][] = [];
    const { scan, fake } = options({ scamLists: listsOf({ phishing_database: [], ftc_dnc: ["+14699825001"] }, asked, Math.floor(now.getTime() / 1000) - 3600) });
    const report = await scanContent(walmart, scan);
    expect(report.level).toBe("high_risk");
    expect(report.summary).toBe("This matches the fake order or voicemail callback scam.");
    expect(report.evidence.map((item) => item.id)).toEqual(expect.arrayContaining(["message-fake-voicemail", "message-fake-order-callback", "message-company-callback", "ftc-dnc"]));
    expect(report.evidence.find((item) => item.id === "ftc-dnc")).toMatchObject({
      signal: "raises_risk",
      title: "A phone number in this message was reported to the FTC for unwanted calls",
      source: { name: "FTC Do Not Call reports", url: "https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data" },
    });
    expect(report.recommendations).toContain(
      "Do not call the number in the message. Check your orders in the company's official app or website, and if you need to call, use the number on its website or on your card.",
    );
    expect(asked.flat()).toEqual(expect.arrayContaining(["+17607662951", "+14699825001"]));
    const everything = JSON.stringify(report) + JSON.stringify(fake.requests);
    for (const digits of ["7607662951", "4699825001", "982-5001"]) {
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

  it("counts a reported number as one warning sign, not proof", async () => {
    const report = await scanContent("hey it's me, my new number is 469-982-5001", options({ scamLists: listsOf({ phishing_database: [], ftc_dnc: ["+14699825001"] }) }).scan);
    expect(report.evidence.some((item) => item.id === "ftc-dnc")).toBe(true);
    expect(["unknown", "suspicious"]).toContain(report.level);
  });
});
