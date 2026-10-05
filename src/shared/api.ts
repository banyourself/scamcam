import { z } from "@hono/zod-openapi";

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    version: z.string(),
    environment: z.string(),
    scanning: z.enum(["available", "not_yet_available", "paused"]),
    turnstileSiteKey: z.string().nullable(),
  })
  .openapi("HealthResponse");

export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string(),
    }),
  })
  .openapi("ApiError");

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
