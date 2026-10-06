import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { maxInputLength } from "../../shared/extract";
import { ApiErrorSchema } from "../../shared/api";
import { ScanReportSchema } from "../../shared/report-schema";
import { reviewMessage, type TextModel } from "../../engine/ai-review";
import { scanContent, type BudgetedProvider } from "../../engine/scan";
import type { AppBindings, AppEnv } from "../env";
import { errorBody } from "../errors";
import { logEvent } from "../logging";
import { clientAddress } from "../middleware/rate-limit";
import { writesArePaused } from "../repositories/app-state";
import { d1DomainList } from "../repositories/domain-lists";
import { recordProviderCall } from "../repositories/provider-usage";
import { verifyTurnstileToken } from "../security/turnstile";

const ScanRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(maxInputLength),
    turnstileToken: z.string().max(2048).optional(),
  })
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

const dailyLimitVariable: Record<BudgetedProvider, keyof AppBindings> = {
  safe_browsing: "SAFE_BROWSING_DAILY_LIMIT",
  urlhaus: "URLHAUS_DAILY_LIMIT",
  workers_ai: "AI_DAILY_LIMIT",
};

function budgetTaker(env: AppBindings) {
  let paused: boolean | null = null;
  return async (provider: BudgetedProvider): Promise<boolean> => {
    paused ??= await writesArePaused(env.DB).catch(() => true);
    if (paused) {
      return provider !== "workers_ai";
    }
    const limit = Number(env[dailyLimitVariable[provider]]);
    const calls = await recordProviderCall(env.DB, provider).catch(() => Number.POSITIVE_INFINITY);
    return Number.isFinite(limit) && calls <= limit;
  };
}

function aiModelFor(env: AppBindings, injected: TextModel | null): TextModel | null {
  if (env.AI_MODE !== "inconclusive") {
    return null;
  }
  if (injected) {
    return injected;
  }
  if (!env.AI) {
    return null;
  }
  const binding = env.AI as unknown as TextModel;
  return { run: (model, input) => binding.run(model, input) };
}

export const scanRoutes = new OpenAPIHono<AppEnv>().openapi(scanRoute, async (c) => {
  const body = c.req.valid("json");
  const { success } = await c.env.SCAN_RATE_LIMITER.limit({ key: clientAddress(c.req.raw) });
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
    fetcher: c.get("fetcher"),
  });
  if (!turnstile.ok) {
    if (turnstile.reason === "not_configured" || turnstile.reason === "unreachable") {
      return c.json(errorBody(c, "unavailable", "Checking is temporarily unavailable. Try again in a minute."), 503);
    }
    return c.json(errorBody(c, "bot_check_failed", "The security check did not pass. Complete it again and resubmit."), 403);
  }
  const takeBudget = budgetTaker(c.env);
  const model = aiModelFor(c.env, c.get("aiModel"));
  const report = await scanContent(body.content, {
    fetcher: c.get("fetcher"),
    safeBrowsingKey: c.env.SAFE_BROWSING_API_KEY,
    urlhausKey: c.env.URLHAUS_AUTH_KEY,
    takeBudget,
    aiReview: model
      ? async (text) => {
          const started = Date.now();
          const result = await reviewMessage(text, { model, modelId: c.env.AI_MODEL, takeBudget: () => takeBudget("workers_ai") });
          logEvent("ai_review", {
            model: c.env.AI_MODEL,
            status: result.status,
            ...(result.status === "ok"
              ? { label: result.label, promptTokens: result.promptTokens, completionTokens: result.completionTokens, neurons: result.neurons }
              : {}),
            ms: Date.now() - started,
          });
          return result;
        }
      : undefined,
    lookups: c.get("lookups"),
    phishingList: d1DomainList(c.env.DB, "phishing_database", c.get("lookups")),
  });
  return c.json(ScanReportSchema.parse(report), 200);
});
