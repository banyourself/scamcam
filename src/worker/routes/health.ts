import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { ApiErrorSchema, HealthResponseSchema } from "../../shared/api";
import type { AppEnv } from "../env";

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  summary: "Report whether the API is running",
  responses: {
    200: { description: "The API is running", content: { "application/json": { schema: HealthResponseSchema } } },
    429: { description: "Too many requests", content: { "application/json": { schema: ApiErrorSchema } } },
  },
});

export const healthRoutes = new OpenAPIHono<AppEnv>().openapi(healthRoute, (c) =>
  c.json(
    {
      status: "ok" as const,
      version: c.env.APP_VERSION,
      environment: c.env.APP_ENV,
      scanning: "not_yet_available" as const,
    },
    200,
  ),
);
