import type { Context } from "hono";
import { turnstileAction } from "../../shared/turnstile";
import type { AppEnv } from "../env";
import { logEvent } from "../logging";
import { clientAddress, rateLimitKey } from "../middleware/rate-limit";
import { verifyTurnstileToken } from "../security/turnstile";

export type ScanGate =
  | { ok: true }
  | { ok: false; status: 403 | 429 | 503; code: "rate_limited" | "bot_check_failed" | "unavailable"; message: string };

export async function passScanGate(c: Context<AppEnv>, token: string | undefined): Promise<ScanGate> {
  const { success } = await c.env.SCAN_RATE_LIMITER.limit({ key: rateLimitKey(c.req.raw) });
  if (!success) {
    c.header("Retry-After", "60");
    return { ok: false, status: 429, code: "rate_limited", message: "You have checked a lot of things in the last minute. Wait a minute and try again." };
  }
  const production = c.env.APP_ENV === "production";
  const turnstile = await verifyTurnstileToken({
    token,
    secret: c.env.TURNSTILE_SECRET_KEY,
    remoteIp: clientAddress(c.req.raw),
    expectedHostname: production ? new URL(c.req.url).hostname : null,
    expectedAction: production ? turnstileAction : null,
    fetcher: c.get("fetcher"),
  });
  if (turnstile.ok) {
    return { ok: true };
  }
  if (turnstile.reason === "not_configured" || turnstile.reason === "unreachable") {
    return { ok: false, status: 503, code: "unavailable", message: "Checking is temporarily unavailable. Try again in a minute." };
  }
  return { ok: false, status: 403, code: "bot_check_failed", message: "The security check did not pass. Complete it again and resubmit." };
}

export async function inScannerOrInline<T>(c: Context<AppEnv>, remote: (namespace: Env["SCANNER"]) => Promise<T>, inline: () => Promise<T>): Promise<T> {
  if (c.get("scans") === "inline" || !c.env.SCANNER) {
    return inline();
  }
  try {
    return await remote(c.env.SCANNER);
  } catch (error) {
    logEvent("alert", { task: "scan", alert: "scanner_unavailable", reason: error instanceof Error ? error.name : "unknown" });
    return inline();
  }
}
