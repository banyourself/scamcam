import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { maxInputLength } from "../../shared/extract";
import { ApiErrorSchema } from "../../shared/api";
import { ScanReportSchema } from "../../shared/report-schema";
import { reportSignatureHeader } from "../../shared/share";
import { turnstileAction } from "../../shared/turnstile";
import type { AppEnv } from "../env";
import { errorBody } from "../errors";
import { logEvent } from "../logging";
import { clientAddress, rateLimitKey } from "../middleware/rate-limit";
import { runScan, type ScanOutcome } from "../scan-runner";
import { scanInScanner } from "../scanner";
import { verifyTurnstileToken } from "../security/turnstile";

const ScanRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(maxInputLength),
    turnstileToken: z.string().max(2048).optional(),
  })
  .strict()
  .openapi("ScanRequest");

const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: ApiErrorSchema } } });

const scanRoute = createRoute({
  method: "post",
  path: "/scans",
  summary: "Check a link or message",
  description: "Runs passive checks on the submitted text. Nothing submitted is stored.",
  request: { body: { required: true, content: { "application/json": { schema: ScanRequestSchema } } } },
  responses: {
    200: { description: "The report", content: { "application/json": { schema: ScanReportSchema } } },
    400: errorResponse("The request is not valid"),
    403: errorResponse("The bot check did not pass"),
    413: errorResponse("The request is too large"),
    429: errorResponse("Too many requests"),
    503: errorResponse("Checking is temporarily unavailable"),
  },
});

async function scanFor(c: Context<AppEnv>, content: string): Promise<ScanOutcome> {
  const inline = () => runScan(c.env, content, { fetcher: c.get("fetcher"), lookups: c.get("lookups"), aiModel: c.get("aiModel") });
  if (c.get("scans") === "inline" || !c.env.SCANNER) {
    return inline();
  }
  try {
    return await scanInScanner(c.env.SCANNER, content);
  } catch (error) {
    logEvent("alert", { task: "scan", alert: "scanner_unavailable", reason: error instanceof Error ? error.name : "unknown" });
    return inline();
  }
}

export const scanRoutes = new OpenAPIHono<AppEnv>().openapi(scanRoute, async (c) => {
  const body = c.req.valid("json");
  const { success } = await c.env.SCAN_RATE_LIMITER.limit({ key: rateLimitKey(c.req.raw) });
  if (!success) {
    c.header("Retry-After", "60");
    return c.json(errorBody(c, "rate_limited", "You have checked a lot of things in the last minute. Wait a minute and try again."), 429);
  }
  const production = c.env.APP_ENV === "production";
  const turnstile = await verifyTurnstileToken({
    token: body.turnstileToken,
    secret: c.env.TURNSTILE_SECRET_KEY,
    remoteIp: clientAddress(c.req.raw),
    expectedHostname: production ? new URL(c.req.url).hostname : null,
    expectedAction: production ? turnstileAction : null,
    fetcher: c.get("fetcher"),
  });
  if (!turnstile.ok) {
    if (turnstile.reason === "not_configured" || turnstile.reason === "unreachable") {
      return c.json(errorBody(c, "unavailable", "Checking is temporarily unavailable. Try again in a minute."), 503);
    }
    return c.json(errorBody(c, "bot_check_failed", "The security check did not pass. Complete it again and resubmit."), 403);
  }
  const { report, signature } = await scanFor(c, body.content);
  if (signature) {
    c.header(reportSignatureHeader, signature);
  }
  return c.json(report, 200);
});
