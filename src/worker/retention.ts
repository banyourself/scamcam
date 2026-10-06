const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const retentionSeconds = {
  errorEvent: 7 * DAY,
  maintenanceRun: 90 * DAY,
  providerUsage: 35 * DAY,
} as const;

export const cleanupBatchSize = 500;
export const cleanupMaxBatchesPerRun = 24;

export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function expiresAfter(seconds: number, from = nowInSeconds()): number {
  return from + seconds;
}
