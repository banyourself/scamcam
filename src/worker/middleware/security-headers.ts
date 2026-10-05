import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";

const apiSecurityHeaders: Record<string, string> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export const secureApiHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(apiSecurityHeaders)) {
    c.res.headers.set(name, value);
  }
  c.res.headers.delete("Server");
  c.res.headers.delete("X-Powered-By");
};
