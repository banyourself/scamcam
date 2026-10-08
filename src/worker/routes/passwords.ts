import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { passwordRange, withPadding } from "../../engine/pwned-passwords";
import { ApiErrorSchema } from "../../shared/api";
import type { AppEnv } from "../env";
import { errorBody } from "../errors";
import { passRateLimit } from "./scan-gate";

const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: ApiErrorSchema } } });

const rangeRoute = createRoute({
  method: "get",
  path: "/passwords/range/{prefix}",
  summary: "Leaked password fingerprints that start with a prefix",
  description:
    "For checking a password in the browser without sending it. The browser sends only the first 5 characters of the password's SHA-1 fingerprint; ScamCam asks Pwned Passwords by Have I Been Pwned for every leaked fingerprint that starts with them and adds random padding (count 0). The browser compares the rest itself. Nothing is stored or logged.",
  request: {
    params: z.object({
      prefix: z
        .string()
        .regex(/^[0-9A-Fa-f]{5}$/)
        .openapi({ param: { name: "prefix", in: "path" }, example: "5BAA6" }),
    }),
  },
  responses: {
    200: { description: "One `SUFFIX:COUNT` line per leaked fingerprint", content: { "text/plain": { schema: z.string() } } },
    400: errorResponse("The prefix is not 5 hexadecimal characters"),
    429: errorResponse("Too many requests"),
    503: errorResponse("Pwned Passwords did not answer"),
  },
});

export const passwordRoutes = new OpenAPIHono<AppEnv>().openapi(rangeRoute, async (c) => {
  const prefix = c.req.valid("param").prefix.toUpperCase();
  const limited = await passRateLimit(c, c.env.PASSWORD_RATE_LIMITER, "You have checked a lot of passwords in the last minute. Wait a minute and try again.");
  if (!limited.ok) {
    return c.json(errorBody(c, limited.code, limited.message), 429);
  }
  const body = await passwordRange(prefix, { fetcher: c.get("fetcher"), lookups: c.get("lookups") });
  if (!body) {
    return c.json(errorBody(c, "unavailable", "Pwned Passwords did not answer. Try again in a minute."), 503);
  }
  return c.text(withPadding(body), 200);
});
