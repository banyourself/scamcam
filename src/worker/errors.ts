import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./env";
import { logEvent } from "./logging";
import { recordErrorEvent } from "./repositories/error-events";

const publicMessages: Partial<Record<number, { code: string; message: string }>> = {
  400: { code: "invalid_request", message: "The request could not be processed." },
  403: { code: "forbidden", message: "This request is not allowed." },
  404: { code: "not_found", message: "This endpoint does not exist." },
  405: { code: "method_not_allowed", message: "This method is not allowed here." },
  413: { code: "payload_too_large", message: "The request is too large." },
  415: { code: "unsupported_media_type", message: "Send the request as JSON." },
  429: { code: "rate_limited", message: "Too many requests. Wait a minute and try again." },
  503: { code: "unavailable", message: "ScamCam is temporarily unavailable. Try again later." },
};

export function apiError(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code?: string,
  message?: string,
): Response {
  const fallback = publicMessages[status] ?? { code: "server_error", message: "Something went wrong." };
  return c.json(
    { error: { code: code ?? fallback.code, message: message ?? fallback.message, requestId: c.get("requestId") ?? "" } },
    status,
  );
}

export function handleNotFound(c: Context<AppEnv>): Response {
  return apiError(c, 404);
}

export function handleError(error: Error, c: Context<AppEnv>): Response {
  if (error instanceof HTTPException && error.status < 500) {
    return apiError(c, error.status as ContentfulStatusCode);
  }
  const route = c.req.routePath || "unknown";
  logEvent("unhandled_error", { requestId: c.get("requestId"), route, name: error.name });
  c.executionCtx.waitUntil(recordErrorEvent(c.env.DB, error.name || "Error", route).catch(() => undefined));
  return apiError(c, 500);
}
