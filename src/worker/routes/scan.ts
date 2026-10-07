import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { maxInputLength } from "../../shared/extract";
import { ApiErrorSchema } from "../../shared/api";
import { ScanReportSchema } from "../../shared/report-schema";
import { reportSignatureHeader } from "../../shared/share";
import type { AppEnv } from "../env";
import { errorBody } from "../errors";
import { runScan, type ScanOutcome } from "../scan-runner";
import { scanInScanner } from "../scanner";
import { inScannerOrInline, passScanGate } from "./scan-gate";

const ScanRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(maxInputLength),
    turnstileToken: z.string().max(2048).optional(),
    fromScreenshot: z.boolean().optional(),
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

async function scanFor(c: Context<AppEnv>, content: string, fromScreenshot: boolean): Promise<ScanOutcome> {
  return inScannerOrInline(
    c,
    (namespace) => scanInScanner(namespace, content, fromScreenshot),
    () => runScan(c.env, content, { fetcher: c.get("fetcher"), lookups: c.get("lookups"), aiModel: c.get("aiModel") }, fromScreenshot),
  );
}

export const scanRoutes = new OpenAPIHono<AppEnv>().openapi(scanRoute, async (c) => {
  const body = c.req.valid("json");
  const gate = await passScanGate(c, body.turnstileToken);
  if (!gate.ok) {
    return c.json(errorBody(c, gate.code, gate.message), gate.status);
  }
  const { report, signature } = await scanFor(c, body.content, body.fromScreenshot ?? false);
  if (signature) {
    c.header(reportSignatureHeader, signature);
  }
  return c.json(report, 200);
});
