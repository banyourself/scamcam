import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { logEvent } from "../logging";

export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const started = Date.now();
  await next();
  logEvent("request", {
    requestId: c.get("requestId"),
    method: c.req.method,
    route: c.req.routePath,
    status: c.res.status,
    durationMs: Date.now() - started,
  });
};
