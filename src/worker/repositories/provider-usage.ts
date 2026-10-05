import type { BudgetedProvider } from "../../engine/scan";
import { expiresAfter, nowInSeconds, retentionSeconds } from "../retention";

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
