import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { budgetTaker } from "../../src/worker/scan-runner";
import { countingDatabase } from "./counting";

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM provider_usage"), env.DB.prepare("DELETE FROM app_state")]);
});

describe("daily budgets", () => {
  it("counts calls that arrive together in one query, exactly, and stops at the limit", async () => {
    const queries = { queries: 0 };
    const take = budgetTaker({ ...env, DB: countingDatabase(env.DB, queries), URLHAUS_DAILY_LIMIT: "2" });
    expect(await Promise.all([take("urlhaus"), take("urlhaus"), take("urlhaus")])).toEqual([true, true, false]);
    expect(queries.queries).toBe(2);
    expect(await take("urlhaus")).toBe(false);
    const usage = await env.DB.prepare("SELECT calls FROM provider_usage WHERE provider = 'urlhaus'").first<{ calls: number }>();
    expect(usage?.calls).toBe(4);
  });

  it("keeps providers apart and counts one call at a time when calls come one by one", async () => {
    const take = budgetTaker({ ...env, SAFE_BROWSING_DAILY_LIMIT: "5", PHISHSTATS_DAILY_LIMIT: "1" });
    expect(await take("safe_browsing")).toBe(true);
    expect(await take("phishstats")).toBe(true);
    expect(await take("phishstats")).toBe(false);
    const usage = await env.DB.prepare("SELECT provider, calls FROM provider_usage ORDER BY provider").all<{ provider: string; calls: number }>();
    expect(usage.results).toEqual([
      { provider: "phishstats", calls: 2 },
      { provider: "safe_browsing", calls: 1 },
    ]);
  });

  it("keeps the core lookups and skips AI and PhishStats when D1 cannot be read", async () => {
    const broken = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("D1 is down"); } }) }) } as unknown as D1Database;
    const take = budgetTaker({ ...env, DB: broken });
    expect(await Promise.all([take("urlhaus"), take("safe_browsing"), take("workers_ai"), take("phishstats")])).toEqual([true, true, false, false]);
  });
});
