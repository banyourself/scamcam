import { describe, expect, it } from "vitest";
import { scanContent } from "../../src/engine/scan";
import { heldoutGamingPhishing, heldoutLegitimate, heldoutRandomPhishing, heldoutSource } from "../fixtures/heldout-domains";

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

describe("held-out benchmark from real Phishing.Database entries, rules only", () => {
  it("never flags the legitimate sites and reports how much the rules catch alone", async () => {
    const gaming = await flagged(heldoutGamingPhishing);
    const random = await flagged(heldoutRandomPhishing);
    const falseAlarms = await flagged(heldoutLegitimate);
    console.log(
      JSON.stringify({
        source: heldoutSource,
        gamingImpersonation: { caught: gaming.length, of: heldoutGamingPhishing.length, recall: Number((gaming.length / heldoutGamingPhishing.length).toFixed(3)) },
        randomPhishing: { caught: random.length, of: heldoutRandomPhishing.length, recall: Number((random.length / heldoutRandomPhishing.length).toFixed(3)) },
        legitimate: { flagged: falseAlarms.length, of: heldoutLegitimate.length, falsePositiveRate: Number((falseAlarms.length / heldoutLegitimate.length).toFixed(3)) },
        falseAlarms,
      }),
    );
    expect(falseAlarms).toEqual([]);
  });
});
