import { extractInput } from "../shared/extract";
import { aimsAtCheckers } from "./injection";
import { analyzeMessage } from "./message-rules";
import { canonicalizeUrl, urlExpressions } from "./safe-browsing";
import { analyzeLink } from "./url-analysis";

const samples = [
  "Hey, send me your 2fa code so I can verify the trade at https://steamcommunity.com/tradeoffer/new/?partner=1",
  "free nitro gift https://discord-gift.example/claim, email help@example.com or call +1 555 010 4477 with code 918273",
];

export function warmUp(): void {
  for (const sample of samples) {
    const extracted = extractInput(sample);
    analyzeMessage(extracted.redactedText);
    aimsAtCheckers(extracted.redactedText);
    for (const link of extracted.links) {
      analyzeLink(link);
      const canonical = canonicalizeUrl(link);
      if (canonical) {
        urlExpressions(canonical);
      }
    }
  }
}
