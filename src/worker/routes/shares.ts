import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorSchema } from "../../shared/api";
import { fromBase64Url, toBase64Url } from "../../shared/base64url";
import { ScanReportSchema } from "../../shared/report-schema";
import { shareIdPattern, shareWindowMinutes, type SharedReport } from "../../shared/share";
import type { AppEnv } from "../env";
import { errorBody } from "../errors";
import { logEvent } from "../logging";
import { rateLimitKey } from "../middleware/rate-limit";
import { writesArePaused } from "../repositories/app-state";
import { activeShares, readShare, storeShare } from "../repositories/shared-reports";
import { nowInSeconds } from "../retention";
import { reportIsAuthentic, sharingConfigured } from "../security/report-signature";

export const maxActiveShares = 2000;

const CreateShareSchema = z
  .object({
    report: ScanReportSchema,
    signature: z.string().min(40).max(64),
    minutes: z.union([z.literal(5), z.literal(10), z.literal(15)]),
    includeMessage: z.boolean(),
  })
  .strict()
  .openapi("CreateShare");

const CreatedShareSchema = z.object({ id: z.string(), key: z.string(), expiresAt: z.iso.datetime() }).openapi("CreatedShare");
const StoredShareSchema = z.object({ iv: z.string(), ciphertext: z.string(), expiresAt: z.iso.datetime() }).openapi("StoredShare");
const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: ApiErrorSchema } } });

const createShareRoute = createRoute({
  method: "post",
  path: "/shares",
  summary: "Make a short-lived share link for a report",
  description:
    "Accepts only a report this service signed in the last 30 minutes. The report is encrypted with a new key that is returned once and not kept, so only the link can open it.",
  request: { body: { required: true, content: { "application/json": { schema: CreateShareSchema } } } },
  responses: {
    201: { description: "The share", content: { "application/json": { schema: CreatedShareSchema } } },
    400: errorResponse("The request is not valid"),
    403: errorResponse("The report was not made by ScamCam or is too old to share"),
    413: errorResponse("The request is too large"),
    429: errorResponse("Too many requests"),
    503: errorResponse("Sharing is temporarily unavailable"),
  },
});

const readShareRoute = createRoute({
  method: "get",
  path: "/shares/{id}",
  summary: "Fetch an encrypted shared report",
  request: { params: z.object({ id: z.string().max(64) }) },
  responses: {
    200: { description: "The encrypted report", content: { "application/json": { schema: StoredShareSchema } } },
    404: errorResponse("The share expired or does not exist"),
    429: errorResponse("Too many requests"),
  },
});

const notFound = "This shared report has expired or does not exist.";

export const shareRoutes = new OpenAPIHono<AppEnv>()
  .openapi(createShareRoute, async (c) => {
    const body = c.req.valid("json");
    const { success } = await c.env.SHARE_RATE_LIMITER.limit({ key: rateLimitKey(c.req.raw) });
    if (!success) {
      c.header("Retry-After", "60");
      return c.json(errorBody(c, "rate_limited", "You have made a lot of share links in the last minute. Wait a minute and try again."), 429);
    }
    if (!sharingConfigured(c.env.SHARE_SIGNING_KEY)) {
      return c.json(errorBody(c, "unavailable", "Sharing is not available right now."), 503);
    }
    const createdAt = Date.parse(body.report.createdAt);
    const age = Date.now() - createdAt;
    if (!(await reportIsAuthentic(body.report, body.signature, c.env.SHARE_SIGNING_KEY)) || !(age >= -60_000 && age <= shareWindowMinutes * 60_000)) {
      return c.json(errorBody(c, "not_shareable", "This report can no longer be shared. Check it again to get a new link."), 403);
    }
    if ((await writesArePaused(c.env.DB).catch(() => true)) || (await activeShares(c.env.DB)) >= maxActiveShares) {
      return c.json(errorBody(c, "unavailable", "Sharing is busy right now. Try again in a few minutes."), 503);
    }
    const expiresAt = nowInSeconds() + body.minutes * 60;
    const report =
      body.report.subject.kind === "message" && !body.includeMessage ? { ...body.report, subject: { ...body.report.subject, display: "" } } : body.report;
    const payload: SharedReport = {
      report,
      includesMessage: body.report.subject.kind !== "message" || body.includeMessage,
      sharedAt: new Date().toISOString(),
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
    const key = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const id = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
    const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(JSON.stringify(payload))));
    await storeShare(c.env.DB, id, iv, ciphertext, expiresAt);
    logEvent("share_created", { minutes: body.minutes, includesMessage: payload.includesMessage });
    return c.json({ id, key: toBase64Url(key), expiresAt: payload.expiresAt }, 201);
  })
  .openapi(readShareRoute, async (c) => {
    const { id } = c.req.valid("param");
    const stored = shareIdPattern.test(id) ? await readShare(c.env.DB, id) : null;
    if (!stored || !fromBase64Url(id)) {
      return c.json(errorBody(c, "share_not_found", notFound), 404);
    }
    return c.json({ iv: toBase64Url(stored.iv), ciphertext: toBase64Url(stored.ciphertext), expiresAt: new Date(stored.expiresAt * 1000).toISOString() }, 200);
  });
