import { describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { scanContent } from "../../src/engine/scan";
import { allowAllBudgets, fakeNetwork, listOf } from "../engine/fake-network";
import { benchmarkCases } from "./benchmark-cases";

const subrequestLimit = 50;

function percentile(values: number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}

describe("performance with every outside source answering", () => {
  it("stays far below the Workers subrequest limit and needs no calls for a repeated scan", async () => {
    const coldCalls: number[] = [];
    const warmCalls: number[] = [];
    const coldMs: number[] = [];
    const warmMs: number[] = [];
    for (const testCase of benchmarkCases) {
      const network = fakeNetwork({ safeBrowsing: () => ({ cacheSeconds: 300 }) });
      const lookups = memoryLookups();
      const options = {
        fetcher: network.fetcher,
        takeBudget: allowAllBudgets,
        safeBrowsingKey: "key",
        urlhausKey: "key",
        lookups,
        phishingList: listOf([]),
      };
      let started = performance.now();
      await scanContent(testCase.input, options);
      coldMs.push(performance.now() - started);
      coldCalls.push(network.requests.length);
      const before = network.requests.length;
      started = performance.now();
      await scanContent(testCase.input, options);
      warmMs.push(performance.now() - started);
      warmCalls.push(network.requests.length - before);
    }
    const average = (values: number[]) => Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
    console.log(
      JSON.stringify({
        cases: benchmarkCases.length,
        outsideCallsPerScan: { cold: average(coldCalls), coldMax: Math.max(...coldCalls), warm: average(warmCalls), warmMax: Math.max(...warmCalls) },
        msPerScan: {
          coldP50: Number(percentile(coldMs, 0.5).toFixed(2)),
          coldP95: Number(percentile(coldMs, 0.95).toFixed(2)),
          warmP50: Number(percentile(warmMs, 0.5).toFixed(2)),
          warmP95: Number(percentile(warmMs, 0.95).toFixed(2)),
        },
      }),
    );
    expect(Math.max(...coldCalls) + 1).toBeLessThan(subrequestLimit / 4);
    expect(warmCalls.every((calls) => calls === 0)).toBe(true);
  });
});
