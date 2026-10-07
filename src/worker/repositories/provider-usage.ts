import type { BudgetedProvider } from "../../engine/scan";
import type { AppBindings } from "../env";
import { expiresAfter, nowInSeconds, retentionSeconds } from "../retention";

export const budgetedProviders: readonly BudgetedProvider[] = ["safe_browsing", "urlhaus", "workers_ai", "phishstats"];

const dailyLimitVariable = {
  safe_browsing: "SAFE_BROWSING_DAILY_LIMIT",
  urlhaus: "URLHAUS_DAILY_LIMIT",
  workers_ai: "AI_DAILY_LIMIT",
  phishstats: "PHISHSTATS_DAILY_LIMIT",
} as const satisfies Record<BudgetedProvider, keyof AppBindings>;

export function dailyLimit(env: AppBindings, provider: BudgetedProvider): number | null {
  const limit = Number(env[dailyLimitVariable[provider]]);
  return Number.isFinite(limit) && limit >= 0 ? limit : null;
}

export function usageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function recordProviderCall(db: D1Database, provider: BudgetedProvider, now = new Date()): Promise<number> {
  const row = await db
    .prepare(
      "INSERT INTO provider_usage (provider, day, calls, expires_at) VALUES (?1, ?2, 1, ?3) " +
        "ON CONFLICT (provider, day) DO UPDATE SET calls = calls + 1 RETURNING calls",
    )
    .bind(provider, usageDay(now), expiresAfter(retentionSeconds.providerUsage, nowInSeconds()))
    .first<{ calls: number }>();
  return row?.calls ?? 0;
}

export async function providerCallsToday(db: D1Database, provider: BudgetedProvider, now = new Date()): Promise<number> {
  const row = await db
    .prepare("SELECT calls FROM provider_usage WHERE provider = ?1 AND day = ?2")
    .bind(provider, usageDay(now))
    .first<{ calls: number }>();
  return row?.calls ?? 0;
}

export async function providerUsageSince(db: D1Database, firstDay: string): Promise<{ provider: BudgetedProvider; day: string; calls: number }[]> {
  const result = await db
    .prepare("SELECT provider, day, calls FROM provider_usage WHERE day >= ?1")
    .bind(firstDay)
    .all<{ provider: BudgetedProvider; day: string; calls: number }>();
  return result.results;
}
