import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { apiError } from "../errors";

export function clientAddress(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

export const rateLimitApi: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { success } = await c.env.API_RATE_LIMITER.limit({ key: clientAddress(c.req.raw) });
  if (!success) {
    c.header("Retry-After", "60");
    return apiError(c, 429);
  }
  await next();
};
