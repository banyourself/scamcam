import { describe, expect, it } from "vitest";
import { scanContent, type ScanOptions } from "../../src/engine/scan";
import type { EmailFacts } from "../../src/shared/email";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { allowAllBudgets, fakeNetwork, listsOf } from "./fake-network";

const now = new Date("2026-10-06T12:00:00.000Z");
const newline = String.fromCharCode(10);

function options(email: EmailFacts, extra: Partial<ScanOptions> = {}) {
  const fake = fakeNetwork({ now });
  return { fake, scan: { fetcher: fake.fetcher, takeBudget: allowAllBudgets, now, email, ...extra } satisfies ScanOptions };
}

function facts(extra: Partial<EmailFacts> = {}): EmailFacts {
  return { spf: "pass", dkim: "pass", dmarc: "pass", replyToDiffers: false, attachments: [], ...extra };
}

const lockNotice = ["From: Steam Support", "Subject: Your account will be locked", "", "Dear user, your account will be locked. Verify it within 24 hours."].join(newline);

describe("email files in scans", () => {
  it("rates a forged support email with a disguised link as high risk", async () => {
    const content = `${lockNotice} [steamcommunity.com/login](https://steam-login.example/verify)`;
    const { scan } = options(facts({ fromDomain: "steam-security-alert.example", spf: "fail", dkim: "none", dmarc: "fail", replyToDiffers: true }));
    const report = await scanContent(content, scan);
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(report.level).toBe("high_risk");
    const ids = report.evidence.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["email-dmarc-fail", "email-name-mismatch", "email-reply-to", "disguised-steam-login.example"]));
    expect(report.evidence.find((item) => item.id === "email-name-mismatch")).toMatchObject({
      signal: "raises_risk",
      title: "The sender's name says Steam, but the email came from steam-security-alert.example",
      source: { name: "ScamCam email check" },
    });
  });

  it("calls out a lookalike sender domain and one that is on a scam list", async () => {
    const asked: string[][] = [];
    const { scan } = options(facts({ fromDomain: "mail.steamcommunlty.com" }), { scamLists: listsOf({ phishing_database: ["steamcommunlty.com"] }, asked) });
    const report = await scanContent(lockNotice, scan);
    expect(report.evidence.find((item) => item.id === "email-sender-lookalike")?.title).toBe("The sender's domain steamcommunlty.com imitates a Steam address");
    expect(report.evidence.find((item) => item.id === "sender-pdb-steamcommunlty.com")).toMatchObject({
      signal: "raises_risk",
      title: "Sender: Phishing.Database lists steamcommunlty.com as a phishing site",
    });
    expect(asked.flat()).toEqual(expect.arrayContaining(["mail.steamcommunlty.com", "steamcommunlty.com"]));
    expect(report.level).toBe("high_risk");
  });

  it("notes a verified official sender without calling the email safe, and never looks it up", async () => {
    const asked: string[][] = [];
    const content = ["From: Steam", "Subject: Your Steam purchase", "", "Thanks for your purchase. It will appear in your library."].join(newline);
    const { scan } = options(facts({ fromDomain: "steampowered.com" }), { scamLists: listsOf({ phishing_database: [] }, asked) });
    const report = await scanContent(content, scan);
    expect(report.evidence.find((item) => item.id === "email-sender-verified")).toMatchObject({ signal: "neutral", title: "Sent from steampowered.com and passed its sender check" });
    expect(report.evidence.some((item) => item.id === "email-name-mismatch")).toBe(false);
    expect(report.evidence.some((item) => item.signal === "lowers_risk")).toBe(false);
    expect(asked).toEqual([]);
    expect(report.level).toBe("no_known_threat");
  });

  it("warns strongly when a well-known company's own sender check fails", async () => {
    const report = await scanContent(lockNotice, options(facts({ fromDomain: "steampowered.com", dmarc: "fail", spf: "fail", dkim: "fail" })).scan);
    expect(report.evidence.find((item) => item.id === "email-dmarc-fail")?.title).toBe("Claims to come from steampowered.com, but failed Steam's sender check");
    expect(report.level).toBe("high_risk");
  });

  it("checks attachments from what was found on the device, and says not to open them", async () => {
    const content = ["From: Billing", "Subject: Invoice 4471", "", "Please see the attached invoice."].join(newline);
    const email = facts({ fromDomain: "billing-mailer.example", attachments: [{ kind: "windows_program", extension: "exe", findings: ["double_extension"] }, { kind: "pdf", findings: [] }] });
    const report = await scanContent(content, options(email).scan);
    expect(report.evidence.map((item) => item.title)).toEqual(expect.arrayContaining(["Attachment 1: This is a Windows program", "Attachment 1: Hides its real type behind a fake ending", "Attachment 2: This is a PDF document"]));
    expect(report.level).toBe("high_risk");
    expect(report.recommendations[0]).toBe("Do not open the attachments, and do not enable editing or content in them.");
  });

  it("says when the email file had no sender check results, and leaves plain senders alone", async () => {
    const content = ["From: Alex", "Subject: lunch?", "", "Want to get lunch tomorrow?"].join(newline);
    const report = await scanContent(content, options(facts({ fromDomain: "gmail.com", spf: "unknown", dkim: "unknown", dmarc: "unknown" })).scan);
    expect(report.evidence.find((item) => item.id === "email-no-auth")?.signal).toBe("neutral");
    expect(report.level).toBe("no_known_threat");
    const unverified = await scanContent(content, options(facts({ fromDomain: "gmail.com", spf: "fail", dkim: "none", dmarc: "none" })).scan);
    expect(unverified.evidence.find((item) => item.id === "email-unverified")?.signal).toBe("raises_risk");
  });
});
