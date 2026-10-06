import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

export const assignRequestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = crypto.randomUUID();
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
};
