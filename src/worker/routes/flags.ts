import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorSchema } from "../../shared/api";
import { toBase64Url } from "../../shared/base64url";
import { extractInput } from "../../shared/extract";
import { flagKeepDays, flagNoteMaxLength, flagReasons, flagWindowHours } from "../../shared/flags";
import type { ScanReport } from "../../shared/report";
import { ScanReportSchema } from "../../shared/report-schema";
import { flagTurnstileAction } from "../../shared/turnstile";
import type { AppEnv } from "../env";
import { errorBody } from "../errors";
import { logEvent } from "../logging";
import { writesArePaused } from "../repositories/app-state";
import { storeFlag } from "../repositories/result-flags";
import { nowInSeconds } from "../retention";
import { reportIsAuthentic, sharingConfigured } from "../security/report-signature";
import { passRateLimit, passTurnstile } from "./scan-gate";

const maxEvidenceText = 2000;
const maxSubjectLength = 253;

const CreateFlagSchema = z
  .object({
    report: ScanReportSchema,
    signature: z.string().min(40).max(64),
    reason: z.enum(flagReasons),
    note: z.string().max(flagNoteMaxLength).optional(),
    turnstileToken: z.string().max(2048).optional(),
  })
  .strict()
  .openapi("CreateFlag");

const CreatedFlagSchema = z.object({ status: z.enum(["received", "already_received"]) }).openapi("CreatedFlag");
const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: ApiErrorSchema } } });

const createFlagRoute = createRoute({
  method: "post",
  path: "/flags",
  summary: "Ask for a person to review a result",
  description:
    "Accepts only a report this service signed in the last 24 hours, once per report. Flags are kept for review and never change any result.",
  request: { body: { required: true, content: { "application/json": { schema: CreateFlagSchema } } } },
  responses: {
    202: { description: "The flag was received for review", content: { "application/json": { schema: CreatedFlagSchema } } },
    400: errorResponse("The request is not valid"),
    403: errorResponse("The report was not made by ScamCam, is too old, or the bot check did not pass"),
    413: errorResponse("The request is too large"),
    429: errorResponse("Too many requests"),
    503: errorResponse("Flagging is temporarily unavailable"),
  },
});

function subjectOf(report: ScanReport): string | null {
  if (report.subject.kind === "file") {
    return report.subject.fingerprint ?? null;
  }
  if (report.subject.registrableDomain) {
    return report.subject.registrableDomain.slice(0, maxSubjectLength);
  }
  if (report.subject.kind === "url") {
    try {
      const display = report.subject.display.trim();
      return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(display) ? display : `https://${display}`).hostname.slice(0, maxSubjectLength) || null;
    } catch {
      return null;
    }
  }
  return null;
}

function cleanNote(note: string | undefined): string | null {
  if (!note) {
    return null;
  }
  const text = extractInput(note)
    .redactedText.replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, flagNoteMaxLength);
  return text === "" ? null : text;
}

async function reportKey(signature: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature)));
  return [...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const flagRoutes = new OpenAPIHono<AppEnv>().openapi(createFlagRoute, async (c) => {
  const body = c.req.valid("json");
  const limited = await passRateLimit(c, c.env.FLAG_RATE_LIMITER, "You have flagged a lot of results in the last minute. Wait a minute and try again.");
  if (!limited.ok) {
    return c.json(errorBody(c, limited.code, limited.message), limited.status);
  }
  if (!sharingConfigured(c.env.SHARE_SIGNING_KEY)) {
    return c.json(errorBody(c, "unavailable", "Flagging is not available right now."), 503);
  }
  const age = Date.now() - Date.parse(body.report.createdAt);
  if (!(age >= -60_000 && age <= flagWindowHours * 3_600_000) || !(await reportIsAuthentic(body.report, body.signature, c.env.SHARE_SIGNING_KEY))) {
    return c.json(errorBody(c, "not_flaggable", "This report can no longer be flagged. Check it again, then flag the new report."), 403);
  }
  const human = await passTurnstile(c, body.turnstileToken, flagTurnstileAction, "Flagging is temporarily unavailable. Try again in a minute.");
  if (!human.ok) {
    return c.json(errorBody(c, human.code, human.message), human.status);
  }
  const dailyLimit = Number(c.env.FLAG_DAILY_LIMIT);
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit <= 0 || (await writesArePaused(c.env.DB).catch(() => true))) {
    return c.json(errorBody(c, "unavailable", "Flagging is paused right now. Try again later."), 503);
  }
  const now = nowInSeconds();
  const outcome = await storeFlag(
    c.env.DB,
    {
      id: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
      reportKey: await reportKey(body.signature),
      caseNumber: body.report.caseNumber.slice(0, 32),
      kind: body.report.subject.kind,
      level: body.report.level,
      subject: subjectOf(body.report),
      evidence: body.report.evidence
        .map((item) => item.id)
        .join(" ")
        .slice(0, maxEvidenceText),
      reason: body.reason,
      note: cleanNote(body.note),
      createdAt: now,
      expiresAt: now + flagKeepDays * 86_400,
    },
    now - (now % 86_400),
    dailyLimit,
  );
  if (outcome === "over_daily_limit") {
    logEvent("alert", { task: "flags", alert: "flags_daily_limit" });
    return c.json(errorBody(c, "unavailable", "ScamCam has received a lot of flags today. Try again tomorrow."), 503);
  }
  logEvent("flag_received", { reason: body.reason, level: body.report.level, kind: body.report.subject.kind, duplicate: outcome === "duplicate" });
  return c.json({ status: outcome === "duplicate" ? ("already_received" as const) : ("received" as const) }, 202);
});
