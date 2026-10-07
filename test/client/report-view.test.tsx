import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportView } from "@/components/report/ReportView";
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

  it("shows a file's fingerprint with a VirusTotal link the visitor opens themselves", () => {
    const fingerprint = "e".repeat(64);
    const file = { ...clean!, subject: { kind: "file" as const, display: "Windows program (.exe), 812 KB", fingerprint } };
    expect(ScanReportSchema.safeParse(file).success).toBe(true);
    const html = render(file);
    expect(html).toContain(`href="https://www.virustotal.com/gui/file/${fingerprint}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("ScamCam does not send it there");
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
