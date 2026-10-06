import { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { requestId } from "hono/request-id";
import { createLookupState, type LookupCache } from "../engine/cache";
import type { AppEnv } from "./env";
import { apiError, handleError, handleNotFound } from "./errors";
import { edgeLookupCache } from "./lookup-cache";
import { rateLimitApi } from "./middleware/rate-limit";
import { requestLogger } from "./middleware/request-logger";
import { secureApiHeaders } from "./middleware/security-headers";
import { healthRoutes } from "./routes/health";
import { scanRoutes } from "./routes/scan";

export const maxRequestBytes = 16 * 1024;

export interface AppOptions {
  fetcher?: typeof fetch;
  lookupCache?: LookupCache;
}

export function createApp(options: AppOptions = {}): OpenAPIHono<AppEnv> {
  const fetcher = options.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const lookupState = createLookupState();
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return apiError(c, 400, "invalid_request", "Some fields are missing or not valid.");
      }
      return undefined;
    },
  });

  app.use("/api/*", requestId({ limitLength: 64 }));
  app.use("/api/*", secureApiHeaders);
  app.use("/api/*", requestLogger);
  app.use("/api/*", csrf());
  app.use("/api/*", bodyLimit({ maxSize: maxRequestBytes, onError: (c) => apiError(c, 413) }));
  app.use("/api/*", rateLimitApi);
  app.use("/api/*", async (c, next) => {
    c.set("fetcher", fetcher);
    c.set("lookups", { cache: options.lookupCache ?? edgeLookupCache(new URL(c.req.url).origin), state: lookupState, clock: Date.now });
    await next();
  });

  app.route("/api/v1", healthRoutes);
  app.route("/api/v1", scanRoutes);
  app.doc31("/api/v1/openapi.json", {
    openapi: "3.1.0",
    info: { title: "ScamCam API", version: "1.0.0", description: "Free, noncommercial scam and phishing checks." },
  });

  app.notFound(handleNotFound);
  app.onError(handleError);
  return app;
}

export const app = createApp();
