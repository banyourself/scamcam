import { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import type { TextModel } from "../engine/ai-review";
import { createLookupState, sharedCacheCallsPerRequest, type LookupCache } from "../engine/cache";
import type { AppEnv, ScanPlacement } from "./env";
import { apiError, handleError, handleNotFound } from "./errors";
import { edgeLookupCache } from "./lookup-cache";
import { rateLimitApi } from "./middleware/rate-limit";
import { assignRequestId } from "./middleware/request-id";
import { requestLogger } from "./middleware/request-logger";
import { secureApiHeaders } from "./middleware/security-headers";
import { breachRoutes } from "./routes/breaches";
import { fileRoutes } from "./routes/files";
import { flagRoutes } from "./routes/flags";
import { statsRoutes } from "./routes/stats";
import { healthRoutes } from "./routes/health";
import { passwordRoutes } from "./routes/passwords";
import { scanRoutes } from "./routes/scan";
import { shareRoutes } from "./routes/shares";

export const maxRequestBytes = 16 * 1024;

export interface AppOptions {
  fetcher?: typeof fetch;
  lookupCache?: LookupCache;
  aiModel?: TextModel;
  scans?: ScanPlacement;
}

export function createApp(options: AppOptions = {}): OpenAPIHono<AppEnv> {
  const fetcher = options.fetcher ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const scans = options.scans ?? (options.fetcher ? "inline" : "scanner");
  const lookupState = createLookupState();
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return apiError(c, 400, "invalid_request", "Some fields are missing or not valid.");
      }
      return undefined;
    },
  });

  app.use("/api/*", assignRequestId);
  app.use("/api/*", secureApiHeaders);
  app.use("/api/*", requestLogger);
  app.use("/api/*", csrf());
  app.use("/api/*", bodyLimit({ maxSize: maxRequestBytes, onError: (c) => apiError(c, 413) }));
  app.use("/api/*", rateLimitApi);
  app.use("/api/*", async (c, next) => {
    c.set("fetcher", fetcher);
    c.set("lookups", {
      cache: options.lookupCache ?? edgeLookupCache(new URL(c.req.url).origin),
      state: lookupState,
      clock: Date.now,
      sharedCacheCalls: { remaining: sharedCacheCallsPerRequest },
    });
    c.set("aiModel", options.aiModel ?? null);
    c.set("scans", scans);
    await next();
  });

  app.route("/api/v1", healthRoutes);
  app.route("/api/v1", scanRoutes);
  app.route("/api/v1", fileRoutes);
  app.route("/api/v1", shareRoutes);
  app.route("/api/v1", flagRoutes);
  app.route("/api/v1", statsRoutes);
  app.route("/api/v1", passwordRoutes);
  app.route("/api/v1", breachRoutes);
  app.doc31("/api/v1/openapi.json", {
    openapi: "3.1.0",
    info: { title: "ScamCam API", version: "1.0.0", description: "Free, noncommercial scam and phishing checks." },
  });

  app.notFound(handleNotFound);
  app.onError(handleError);
  return app;
}

export const app = createApp();
