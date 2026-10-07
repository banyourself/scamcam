import { describe, expect, it } from "vitest";
import { scanContent } from "../../src/engine/scan";
import {
  freshGamingPhishing,
  freshRandomPhishing,
  freshSource,
  heldoutGamingPhishing,
  heldoutLegitimate,
  heldoutRandomPhishing,
  heldoutSource,
} from "../fixtures/heldout-domains";

const flaggedLevels = new Set(["suspicious", "high_risk", "confirmed_malicious"]);

const offline: typeof fetch = async () => {
  throw new TypeError("outside sources are switched off for the benchmark");
};

async function flagged(domains: string[]): Promise<string[]> {
  const hits: string[] = [];
  for (const domain of domains) {
    const report = await scanContent(`https://${domain}/`, { fetcher: offline, takeBudget: async () => true });
    if (flaggedLevels.has(report.level)) {
      hits.push(domain);
    }
  }
  return hits;
}

function recall(caught: string[], of: string[]) {
  return { caught: caught.length, of: of.length, recall: Number((caught.length / of.length).toFixed(3)) };
}

describe("benchmark from real Phishing.Database entries, rules only", () => {
  it("never flags the legitimate sites and reports how much the rules catch alone", async () => {
    const falseAlarms = await flagged(heldoutLegitimate);
    console.log(
      JSON.stringify({
        tuning: { source: heldoutSource, gamingImpersonation: recall(await flagged(heldoutGamingPhishing), heldoutGamingPhishing), randomPhishing: recall(await flagged(heldoutRandomPhishing), heldoutRandomPhishing) },
        heldOut: { source: freshSource, gamingImpersonation: recall(await flagged(freshGamingPhishing), freshGamingPhishing), randomPhishing: recall(await flagged(freshRandomPhishing), freshRandomPhishing) },
        legitimate: { flagged: falseAlarms.length, of: heldoutLegitimate.length, falsePositiveRate: Number((falseAlarms.length / heldoutLegitimate.length).toFixed(3)) },
        falseAlarms,
      }),
    );
    expect(falseAlarms).toEqual([]);
  });
});
