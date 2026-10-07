import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorSchema } from "../../shared/api";
import { fileExtensionPattern, fileFindings, fileKinds, maxFileBytes, maxPackJars, modIdPattern, sha1Pattern, type FileCheckRequest } from "../../shared/file-check";
import { ScanReportSchema } from "../../shared/report-schema";
import { reportSignatureHeader } from "../../shared/share";
import type { AppEnv } from "../env";
import { errorBody } from "../errors";
import { runFileCheck } from "../scan-runner";
import { checkFileInScanner } from "../scanner";
import { inScannerOrInline, passScanGate } from "./scan-gate";

const FileCheckSchema = z
  .object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    sha1: z.string().regex(/^[0-9a-f]{40}$/).optional(),
    size: z.number().int().min(0).max(maxFileBytes),
    kind: z.enum(fileKinds),
    extension: z.string().regex(fileExtensionPattern).optional(),
    findings: z.array(z.enum(fileFindings)).max(fileFindings.length),
    modId: z.string().regex(modIdPattern).optional(),
    packJars: z.array(z.string().regex(sha1Pattern)).max(maxPackJars).optional(),
    turnstileToken: z.string().max(2048).optional(),
  })
  .strict()
  .openapi("FileCheckRequest");

const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: ApiErrorSchema } } });

const fileRoute = createRoute({
  method: "post",
  path: "/files",
  summary: "Check a file by its fingerprint",
  description:
    "The visitor's browser reads the file and sends only its SHA-256 and SHA-1 fingerprints, size, detected type, extension, and fixed finding codes, plus the mod ID a Minecraft mod names and the SHA-1 fingerprints of mods a modpack carries or gets from outside Modrinth. The file and its name never reach the server, and nothing is stored.",
  request: { body: { required: true, content: { "application/json": { schema: FileCheckSchema } } } },
  responses: {
    200: { description: "The report", content: { "application/json": { schema: ScanReportSchema } } },
    400: errorResponse("The request is not valid"),
    403: errorResponse("The bot check did not pass"),
    429: errorResponse("Too many requests"),
    503: errorResponse("Checking is temporarily unavailable"),
  },
});

export const fileRoutes = new OpenAPIHono<AppEnv>().openapi(fileRoute, async (c) => {
  const { turnstileToken, ...fields } = c.req.valid("json");
  const gate = await passScanGate(c, turnstileToken);
  if (!gate.ok) {
    return c.json(errorBody(c, gate.code, gate.message), gate.status);
  }
  const request: FileCheckRequest = {
    ...(fields.sha256 ? { sha256: fields.sha256 } : {}),
    ...(fields.sha256 && fields.sha1 ? { sha1: fields.sha1 } : {}),
    size: fields.size,
    kind: fields.kind,
    ...(fields.extension ? { extension: fields.extension } : {}),
    findings: [...new Set(fields.findings)],
    ...(fields.modId && fields.sha1 && fields.kind === "java_archive" && fields.findings.includes("minecraft_mod") ? { modId: fields.modId } : {}),
    ...(fields.packJars && fields.kind === "minecraft_modpack" ? { packJars: [...new Set(fields.packJars)] } : {}),
  };
  const { report, signature } = await inScannerOrInline(
    c,
    (namespace) => checkFileInScanner(namespace, request),
    () => runFileCheck(c.env, request, { fetcher: c.get("fetcher"), lookups: c.get("lookups"), aiModel: c.get("aiModel") }),
  );
  if (signature) {
    c.header(reportSignatureHeader, signature);
  }
  return c.json(report, 200);
});
