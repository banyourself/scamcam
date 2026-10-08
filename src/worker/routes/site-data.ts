import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { ApiErrorSchema } from "../../shared/api";
import type { SiteDataset } from "../../shared/site-data";
import type { AppEnv } from "../env";
import { errorBody } from "../errors";
import { readDataset } from "../repositories/site-data";

const gzipBody = { "application/gzip": { schema: z.string().openapi({ format: "binary" }) } };
const errors = {
  429: { description: "Too many requests", content: { "application/json": { schema: ApiErrorSchema } } },
  503: { description: "The data has not been built yet or could not be read", content: { "application/json": { schema: ApiErrorSchema } } },
};

const securityRoute = createRoute({
  method: "get",
  path: "/site-security",
  summary: "Two-step verification, passkey, and change-password links for websites",
  description:
    "A gzip-compressed JSON copy of 2FA Directory (MIT), Passkeys Directory (CC BY 4.0), both by 2factorauth, and the change-password links from Apple's Password Manager Resources (MIT), rebuilt daily. The visitor's browser searches it, so search words never reach the server.",
  responses: { 200: { description: "The site security data", content: gzipBody }, ...errors },
});

const noticesRoute = createRoute({
  method: "get",
  path: "/breach-notices",
  summary: "Data breach notices filed with the Washington and California attorneys general",
  description:
    "A gzip-compressed JSON copy of the breach notices the Washington State and California attorneys general publish, rebuilt daily. The visitor's browser searches it, so search words never reach the server.",
  responses: { 200: { description: "The breach notices", content: gzipBody }, ...errors },
});

async function serve(c: Context<AppEnv>, dataset: SiteDataset) {
  const stored = await readDataset(c.env.DB, dataset).catch(() => null);
  if (!stored) {
    return c.json(errorBody(c, "unavailable", "This list is not available right now. Try again in a few minutes."), 503);
  }
  return new Response(stored.bytes, {
    status: 200,
    headers: { "Content-Type": "application/gzip", "X-Data-Version": stored.version, "X-Data-Built-At": new Date(stored.builtAt * 1000).toISOString() },
  });
}

export const siteDataRoutes = new OpenAPIHono<AppEnv>()
  .openapi(securityRoute, (c) => serve(c, "site-security"))
  .openapi(noticesRoute, (c) => serve(c, "breach-notices"));
