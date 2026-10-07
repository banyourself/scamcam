import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { maxInputLength } from "../../shared/extract";
import { ApiErrorSchema } from "../../shared/api";
import { authResults, emailDomainPattern, maxEmailAttachments, type EmailFacts } from "../../shared/email";
import { fileExtensionPattern, fileFindings, fileKinds } from "../../shared/file-check";
import { ScanReportSchema } from "../../shared/report-schema";
import { reportSignatureHeader } from "../../shared/share";
import type { AppEnv } from "../env";
import { errorBody } from "../errors";
import { runScan, type ScanOutcome } from "../scan-runner";
import { scanInScanner } from "../scanner";
import { inScannerOrInline, passScanGate } from "./scan-gate";

const EmailFactsSchema = z
  .object({
    fromDomain: z.string().max(253).regex(emailDomainPattern).optional(),
    spf: z.enum(authResults),
    dkim: z.enum(authResults),
    dmarc: z.enum(authResults),
    replyToDiffers: z.boolean(),
    attachments: z
      .array(
        z
          .object({
            kind: z.enum(fileKinds),
            extension: z.string().regex(fileExtensionPattern).optional(),
            findings: z.array(z.enum(fileFindings)).max(fileFindings.length),
          })
          .strict(),
      )
      .max(maxEmailAttachments),
  })
  .strict()
  .openapi("EmailFacts");

const ScanRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(maxInputLength),
    turnstileToken: z.string().max(2048).optional(),
    fromScreenshot: z.boolean().optional(),
    email: EmailFactsSchema.optional(),
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

async function scanFor(c: Context<AppEnv>, content: string, fromScreenshot: boolean, email: EmailFacts | undefined): Promise<ScanOutcome> {
  return inScannerOrInline(
    c,
    (namespace) => scanInScanner(namespace, content, fromScreenshot, email),
    () => runScan(c.env, content, { fetcher: c.get("fetcher"), lookups: c.get("lookups"), aiModel: c.get("aiModel") }, fromScreenshot, email),
  );
}

export const scanRoutes = new OpenAPIHono<AppEnv>().openapi(scanRoute, async (c) => {
  const body = c.req.valid("json");
  const gate = await passScanGate(c, body.turnstileToken);
  if (!gate.ok) {
    return c.json(errorBody(c, gate.code, gate.message), gate.status);
  }
  const email: EmailFacts | undefined = body.email
    ? {
        ...(body.email.fromDomain ? { fromDomain: body.email.fromDomain } : {}),
        spf: body.email.spf,
        dkim: body.email.dkim,
        dmarc: body.email.dmarc,
        replyToDiffers: body.email.replyToDiffers,
        attachments: body.email.attachments.map((attachment) => ({
          kind: attachment.kind,
          ...(attachment.extension ? { extension: attachment.extension } : {}),
          findings: [...new Set(attachment.findings)],
        })),
      }
    : undefined;
  const { report, signature } = await scanFor(c, body.content, body.fromScreenshot ?? false, email);
  if (signature) {
    c.header(reportSignatureHeader, signature);
  }
  return c.json(report, 200);
});
