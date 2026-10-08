import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { fetchBreachCatalog } from "../../engine/breach-catalog";
import { cachedLookup, cacheKey } from "../../engine/cache";
import { ApiErrorSchema, BreachCatalogSchema, type BreachCatalog } from "../../shared/api";
import { isBreachCatalog } from "../../shared/breaches";
import type { AppEnv } from "../env";
import { errorBody } from "../errors";
import { breachCatalogInScanner } from "../scanner";
import { inScannerOrInline } from "./scan-gate";

export const breachCatalogEdgeSeconds = 6 * 60 * 60;

const isCatalogOrNothing = (value: unknown): value is BreachCatalog | null => isBreachCatalog(value);

const catalogRoute = createRoute({
  method: "get",
  path: "/breaches",
  summary: "Known data breaches of websites and companies",
  description:
    "A compact copy of Have I Been Pwned's public list of breached sites (CC BY 4.0), refreshed at least daily. The visitor's browser searches it, so search words never reach the server.",
  responses: {
    200: { description: "The breach list", content: { "application/json": { schema: BreachCatalogSchema } } },
    429: { description: "Too many requests", content: { "application/json": { schema: ApiErrorSchema } } },
    503: { description: "The list could not be loaded", content: { "application/json": { schema: ApiErrorSchema } } },
  },
});

async function loadCatalog(c: Context<AppEnv>): Promise<BreachCatalog | null> {
  const lookups = c.get("lookups");
  const key = await cacheKey("breach-catalog", "v1");
  const { value } = await cachedLookup(
    lookups,
    key,
    isCatalogOrNothing,
    () =>
      inScannerOrInline(
        c,
        (namespace) => breachCatalogInScanner(namespace),
        () => fetchBreachCatalog(c.get("fetcher"), new Date(lookups.clock())),
      ),
    (catalog) => (catalog ? breachCatalogEdgeSeconds : 0),
  );
  return value;
}

export const breachRoutes = new OpenAPIHono<AppEnv>().openapi(catalogRoute, async (c) => {
  const catalog = await loadCatalog(c);
  if (!catalog) {
    return c.json(errorBody(c, "unavailable", "The breach list could not be loaded right now. Try again in a few minutes."), 503);
  }
  return c.json(catalog, 200);
});
