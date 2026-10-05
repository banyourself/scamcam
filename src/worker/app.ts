import { OpenAPIHono } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { requestId } from "hono/request-id";
import type { AppEnv } from "./env";
import { apiError, handleError, handleNotFound } from "./errors";
import { rateLimitApi } from "./middleware/rate-limit";
import { requestLogger } from "./middleware/request-logger";
import { secureApiHeaders } from "./middleware/security-headers";
import { healthRoutes } from "./routes/health";

export const maxRequestBytes = 16 * 1024;

export function createApp(): OpenAPIHono<AppEnv> {
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

  app.route("/api/v1", healthRoutes);
  app.doc31("/api/v1/openapi.json", {
    openapi: "3.1.0",
    info: { title: "ScamCam API", version: "1.0.0", description: "Free, noncommercial scam and phishing checks." },
  });

  app.notFound(handleNotFound);
  app.onError(handleError);
  return app;
}

export const app = createApp();
