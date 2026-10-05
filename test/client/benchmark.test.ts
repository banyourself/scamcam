import { describe, expect, it } from "vitest";
import { scanContent } from "../../src/engine/scan";
import { benchmarkCases } from "./benchmark-cases";

const flagged = new Set(["suspicious", "high_risk", "confirmed_malicious"]);

describe("labeled benchmark with outside sources switched off", () => {
  it("catches scams without flagging the real sites and chats", async () => {
    const offline: typeof fetch = async () => {
      throw new TypeError("outside sources are switched off for the benchmark");
    };
    const misses: string[] = [];
    const falseAlarms: string[] = [];
    let truePositives = 0;
    let trueNegatives = 0;
    const started = Date.now();
    for (const testCase of benchmarkCases) {
      const report = await scanContent(testCase.input, { fetcher: offline, takeBudget: async () => true });
      const isFlagged = flagged.has(report.level);
      if (testCase.label === "scam") {
        if (isFlagged) {
          truePositives += 1;
        } else {
          misses.push(`${testCase.note}: ${report.level}`);
        }
      } else if (isFlagged) {
        falseAlarms.push(`${testCase.note}: ${report.level}`);
      } else {
        trueNegatives += 1;
      }
    }
    const scams = benchmarkCases.filter((testCase) => testCase.label === "scam").length;
    const safe = benchmarkCases.length - scams;
    const precision = truePositives / (truePositives + falseAlarms.length);
    const recall = truePositives / scams;
    console.log(
      JSON.stringify({
        cases: benchmarkCases.length,
        scams,
        safe,
        truePositives,
        trueNegatives,
        falsePositives: falseAlarms.length,
        falseNegatives: misses.length,
        precision: Number(precision.toFixed(3)),
        recall: Number(recall.toFixed(3)),
        falsePositiveRate: Number((falseAlarms.length / safe).toFixed(3)),
        msPerCase: Number(((Date.now() - started) / benchmarkCases.length).toFixed(2)),
        misses,
        falseAlarms,
      }),
    );
    expect(falseAlarms).toEqual([]);
    expect(recall).toBeGreaterThanOrEqual(0.9);
  });
});
