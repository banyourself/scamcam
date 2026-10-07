import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlagControls } from "@/components/report/FlagControls";
import { ReportView } from "@/components/report/ReportView";
import { ScanPanel } from "@/components/scan/ScanPanel";
import { previewReports } from "@/preview-reports";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { riskLabels } from "../../src/shared/report";

const [highRisk, clean, suspicious] = previewReports;

function render(report: (typeof previewReports)[number]) {
  return renderToStaticMarkup(<ReportView report={report} />);
}

describe("ReportView", () => {
  it("uses only reports that match the API schema", () => {
    for (const report of previewReports) {
      expect(ScanReportSchema.safeParse(report).success).toBe(true);
    }
  });

  it("writes the risk level in words, not only color", () => {
    const html = render(highRisk!);
    expect(html).toContain(riskLabels.high_risk);
    expect(html).toContain("Risk level: High risk");
  });

  it("labels each finding as an exhibit with its source and time", () => {
    const html = render(highRisk!);
    expect(html).toContain("Exhibit A");
    expect(html).toContain("Exhibit C");
    expect(html).toContain("RDAP registry data");
    expect(html).toMatch(/<time dateTime="2026-10-05T14:02:00.000Z"/);
  });

  it("offers outside checkers the visitor opens themselves, for files and domains", () => {
    const fingerprint = "e".repeat(64);
    const file = { ...clean!, subject: { kind: "file" as const, display: "Windows program (.exe), 812 KB", fingerprint } };
    expect(ScanReportSchema.safeParse(file).success).toBe(true);
    const fileHtml = render(file);
    expect(fileHtml).toContain(`href="https://www.virustotal.com/gui/file/${fingerprint}"`);
    expect(fileHtml).toContain(`href="https://hybrid-analysis.com/search?query=${fingerprint}"`);
    expect(fileHtml).toContain('rel="noopener noreferrer"');
    const site = { ...clean!, subject: { kind: "url" as const, display: "https://cheap-skins.example/", registrableDomain: "cheap-skins.example" } };
    const siteHtml = render(site);
    expect(siteHtml).toContain('href="https://www.virustotal.com/gui/domain/cheap-skins.example"');
    expect(siteHtml).toContain('href="https://transparencyreport.google.com/safe-browsing/search?url=cheap-skins.example"');
    expect(siteHtml).toContain("ScamCam does not send it");
    const odd = { ...clean!, subject: { kind: "url" as const, display: "x", registrableDomain: "bad domain\"><script>" } };
    expect(render(odd)).not.toContain("Check it yourself elsewhere");
  });

  it("lists sources that could not be checked", () => {
    expect(render(highRisk!)).toContain("Google Safe Browsing did not respond");
    expect(render(suspicious!)).toContain("free limit was reached");
  });

  it("never presents a clean result as proof of safety", () => {
    const html = render(clean!);
    expect(html).toContain("does not prove it is safe");
    expect(html).toContain("A clean result never proves");
  });

  it("shows Google's attribution only when Safe Browsing evidence is used", () => {
    expect(render(clean!)).toContain("Advisory provided by Google");
    expect(render(highRisk!)).not.toContain("Advisory provided by Google");
  });

  it("escapes hostile content from the subject", () => {
    const html = render({ ...highRisk!, subject: { kind: "message", display: "<img src=x onerror=alert(1)>" } });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("FlagControls", () => {
  it("offers a review-only flag and says it never changes the result", () => {
    const html = renderToStaticMarkup(<FlagControls report={highRisk!} signature={"A".repeat(43)} siteKey={null} />);
    expect(html).toContain("Think this result is wrong?");
    expect(html).toContain("Flag result as incorrect");
    expect(html).toContain("never changes any result by itself");
  });
});

describe("ScanPanel", () => {
  it("offers a small Clear text button that is off while the box is empty", () => {
    const html = renderToStaticMarkup(<ScanPanel health={{ state: "checking" }} onReport={() => undefined} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Clear text<\/button>/);
  });
});
