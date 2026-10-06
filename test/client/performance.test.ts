import { describe, expect, it } from "vitest";
import { createLookupState, memoryLookupCache, type LookupCache, type Lookups } from "../../src/engine/cache";
import { scanContent } from "../../src/engine/scan";
import { allowAllBudgets, fakeNetwork, listOf } from "../engine/fake-network";
import { benchmarkCases } from "./benchmark-cases";

const subrequestLimit = 50;
const routeSubrequests = 10;

function percentile(values: number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}

function countedCache(): { cache: LookupCache; counter: { calls: number } } {
  const inner = memoryLookupCache();
  const counter = { calls: 0 };
  return {
    counter,
    cache: {
      get: (key) => {
        counter.calls += 1;
        return inner.get(key);
      },
      put: (key, value, ttlSeconds) => {
        counter.calls += 1;
        return inner.put(key, value, ttlSeconds);
      },
    },
  };
}

async function measure(input: string) {
  const network = fakeNetwork({ safeBrowsing: () => ({ cacheSeconds: 300 }) });
  const { cache, counter } = countedCache();
  const lookups: Lookups = { cache, state: createLookupState(), clock: Date.now };
  const options = { fetcher: network.fetcher, takeBudget: allowAllBudgets, safeBrowsingKey: "key", urlhausKey: "key", lookups, phishingList: listOf([]) };
  let started = performance.now();
  await scanContent(input, options);
  const coldMs = performance.now() - started;
  const cold = network.requests.length + counter.calls;
  const before = cold;
  started = performance.now();
  await scanContent(input, options);
  const warmMs = performance.now() - started;
  return { cold, warm: network.requests.length + counter.calls - before, coldMs, warmMs };
}

const twentyLinks = [
  Array.from({ length: 20 }, (_, index) => `https://login.secure${index}.account-check${index}.example/a/b/c/d/e/f?x=${index}`).join(" "),
  Array.from({ length: 20 }, (_, index) => `https://steam-trade${index}.example/tradeoffer/new/?partner=${index}`).join(" "),
];

describe("performance with every outside source answering", () => {
  it("keeps outside calls and shared cache calls within the Free plan's subrequest limit, and a repeated scan needs none", async () => {
    const results = [];
    for (const input of [...benchmarkCases.map((testCase) => testCase.input), ...twentyLinks]) {
      results.push(await measure(input));
    }
    const benchmark = results.slice(0, benchmarkCases.length);
    const average = (values: number[]) => Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
    console.log(
      JSON.stringify({
        cases: benchmarkCases.length,
        subrequestsPerScan: {
          cold: average(benchmark.map((result) => result.cold)),
          coldMax: Math.max(...benchmark.map((result) => result.cold)),
          twentyLinksCold: results.slice(benchmarkCases.length).map((result) => result.cold),
          warmMax: Math.max(...results.map((result) => result.warm)),
        },
        msPerScan: {
          coldP50: Number(percentile(benchmark.map((result) => result.coldMs), 0.5).toFixed(2)),
          coldP95: Number(percentile(benchmark.map((result) => result.coldMs), 0.95).toFixed(2)),
          warmP50: Number(percentile(benchmark.map((result) => result.warmMs), 0.5).toFixed(2)),
          warmP95: Number(percentile(benchmark.map((result) => result.warmMs), 0.95).toFixed(2)),
        },
      }),
    );
    expect(Math.max(...results.map((result) => result.cold))).toBeLessThanOrEqual(subrequestLimit - routeSubrequests);
    expect(results.every((result) => result.warm === 0)).toBe(true);
  });
});
