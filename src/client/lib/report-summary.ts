import { riskLabels, type ScanReport } from "../../shared/report";

export const reportableLevels = new Set<ScanReport["level"]>(["suspicious", "high_risk", "confirmed_malicious"]);
const maxMessageCharacters = 500;
const maxReasons = 6;

export interface ReportPlace {
  name: string;
  href: string;
  note: string;
}

function checkedDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function subjectLine(report: ScanReport): string {
  const { kind, display, fingerprint } = report.subject;
  if (kind === "file") {
    return fingerprint ? `a file with SHA-256 ${fingerprint}` : "a file";
  }
  if (kind === "message") {
    const text = display.replace(/\s+/g, " ").trim();
    return text ? `this message: "${text.length > maxMessageCharacters ? text.slice(0, maxMessageCharacters) + "..." : text}"` : "a message";
  }
  return display;
}

export function reportSummary(report: ScanReport): string {
  const reasons = report.evidence
    .filter((item) => item.signal === "raises_risk")
    .slice(0, maxReasons)
    .map((item) => `- ${item.title} (${item.source.name})`);
  return [
    `ScamCam rated this "${riskLabels[report.level]}" (${report.confidence} confidence) on ${checkedDate(report.createdAt)}.`,
    `Checked: ${subjectLine(report)}`,
    ...(reasons.length ? ["Why:", ...reasons] : []),
    `Case ${report.caseNumber}, checked at https://scamcam.kevinle.tech`,
  ].join("\n");
}

function linkTarget(report: ScanReport): string | null {
  const display = report.subject.display.trim();
  if (/^https?:\/\/\S+$/i.test(display)) {
    return display;
  }
  return report.subject.registrableDomain ? `https://${report.subject.registrableDomain}/` : null;
}

export function reportPlaces(report: ScanReport): ReportPlace[] {
  const discord: ReportPlace = { name: "Discord", href: "https://dis.gd/report", note: "if it reached you on Discord" };
  const ftc: ReportPlace = { name: "FTC", href: "https://reportfraud.ftc.gov/", note: "any scam, in the United States" };
  if (report.subject.kind === "file") {
    return [
      { name: "Microsoft", href: "https://www.microsoft.com/en-us/wdsi/filesubmission", note: "send the file for malware analysis" },
      discord,
      ftc,
    ];
  }
  if (report.subject.kind === "message") {
    return [
      discord,
      { name: "Steam Support", href: "https://help.steampowered.com/en/", note: "trade or account scams on Steam" },
      { name: "APWG", href: "https://apwg.org/reportphishing/", note: "forward phishing emails to reportphishing@apwg.org" },
      ftc,
    ];
  }
  const target = linkTarget(report);
  return [
    {
      name: "Google Safe Browsing",
      href: target
        ? `https://safebrowsing.google.com/safebrowsing/report_phish/?url=${encodeURIComponent(target)}`
        : "https://safebrowsing.google.com/safebrowsing/report_phish/",
      note: "warns Chrome, Firefox, and Safari users",
    },
    { name: "Microsoft", href: "https://www.microsoft.com/en-us/wdsi/support/report-unsafe-site", note: "warns Edge users" },
    discord,
    ftc,
  ];
}
