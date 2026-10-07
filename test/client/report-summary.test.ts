import { describe, expect, it } from "vitest";
import type { ScanReport } from "../../src/shared/report";
import { reportableLevels, reportPlaces, reportSummary } from "../../src/client/lib/report-summary";

const base: ScanReport = {
  caseNumber: "SC-261007-AB12",
  createdAt: "2026-10-07T15:00:00.000Z",
  subject: { kind: "url", display: "https://steamcommunity-trade.example/tradeoffer/new/", registrableDomain: "steamcommunity-trade.example" },
  level: "high_risk",
  confidence: "medium",
  summary: "This looks like a fake Steam trade page.",
  evidence: [
    { id: "a", signal: "raises_risk", title: "The domain imitates steamcommunity.com", detail: "", source: { name: "ScamCam domain check" }, checkedAt: "" },
    { id: "b", signal: "lowers_risk", title: "Not on known lists", detail: "", source: { name: "URLhaus" }, checkedAt: "" },
  ],
  notChecked: [],
  recommendations: [],
  usesGoogleSafeBrowsing: false,
};

describe("report summary", () => {
  it("lists only the reasons that raise risk and names the case", () => {
    const text = reportSummary(base);
    expect(text).toContain('rated this "High risk" (medium confidence)');
    expect(text).toContain("Checked: https://steamcommunity-trade.example/tradeoffer/new/");
    expect(text).toContain("- The domain imitates steamcommunity.com (ScamCam domain check)");
    expect(text).not.toContain("Not on known lists");
    expect(text).toContain("Case SC-261007-AB12");
  });

  it("quotes a message but caps its length", () => {
    const text = reportSummary({ ...base, subject: { kind: "message", display: "x".repeat(900) } });
    expect(text).toMatch(/Checked: this message: "x{500}\.\.\."/);
  });

  it("offers places that fit the kind of thing checked", () => {
    const links = reportPlaces(base).map((place) => place.name);
    expect(links).toEqual(["Google Safe Browsing", "Microsoft", "Discord", "FTC"]);
    expect(reportPlaces(base)[0]!.href).toBe(
      "https://safebrowsing.google.com/safebrowsing/report_phish/?url=" + encodeURIComponent("https://steamcommunity-trade.example/tradeoffer/new/"),
    );
    expect(reportPlaces({ ...base, subject: { kind: "message", display: "hi" } }).map((place) => place.name)).toContain("APWG");
    expect(reportPlaces({ ...base, subject: { kind: "file", display: "mod.jar", fingerprint: "a".repeat(64) } })[0]!.name).toBe("Microsoft");
  });

  it("only shows for suspicious results or worse", () => {
    expect([...reportableLevels].sort()).toEqual(["confirmed_malicious", "high_risk", "suspicious"]);
  });
});
