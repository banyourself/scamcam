import { extractInput } from "../shared/extract";
import { ScanReportSchema } from "../shared/report-schema";
import { brandsNamedIn } from "./brands";
import { aimsAtCheckers } from "./injection";
import { analyzeMessage, normalizeMessage } from "./message-rules";
import { unwrapRedirect } from "./redirects";
import { canonicalizeUrl, urlExpressions } from "./safe-browsing";
import { analyzeLink } from "./url-analysis";

const samples = [
  "Hey, send me your 2fa code so I can verify the trade at https://steamcommunity.com/tradeoffer/new/?partner=1",
  "free nitro gift https://discord-gift.example/claim, email help@example.com or call +1 555 010 4477 with code 918273",
];

const sampleReport = {
  caseNumber: "SC-000000-0000",
  createdAt: "2026-10-05T00:00:00.000Z",
  subject: { kind: "url", display: "https://example.com/", registrableDomain: "example.com" },
  level: "unknown",
  confidence: "low",
  summary: "Sample",
  evidence: [
    {
      id: "sample",
      signal: "neutral",
      title: "Sample",
      detail: "Sample",
      source: { name: "Sample", url: "https://example.com/" },
      checkedAt: "2026-10-05T00:00:00.000Z",
    },
  ],
  notChecked: [{ name: "Sample", reason: "unavailable" }],
  recommendations: ["Sample"],
  usesGoogleSafeBrowsing: false,
};

export function warmUp(): void {
  ScanReportSchema.parse(sampleReport);
  for (const sample of samples) {
    const extracted = extractInput(sample);
    analyzeMessage(extracted.redactedText);
    aimsAtCheckers(extracted.redactedText);
    brandsNamedIn(normalizeMessage(extracted.redactedText));
    for (const link of extracted.links) {
      const analyzed = analyzeLink(link);
      if (analyzed.href) {
        unwrapRedirect(analyzed.href);
      }
      const canonical = canonicalizeUrl(link);
      if (canonical) {
        urlExpressions(canonical);
      }
    }
  }
}
