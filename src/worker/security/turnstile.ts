import { z } from "zod";
import { deadline } from "../../engine/deadline";
import { readLimitedJson } from "../../engine/limited-body";

const verifyEndpoint = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const maxTokenLength = 2048;
const maxResponseBytes = 64 * 1024;

const SiteverifyResponseSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
});

export type TurnstileOutcome =
  | { ok: true }
  | { ok: false; reason: "missing_token" | "not_configured" | "rejected" | "unreachable" };

export interface TurnstileOptions {
  token: string | undefined;
  secret: string | undefined;
  remoteIp: string;
  expectedHostname: string | null;
  expectedAction?: string | null;
  fetcher?: typeof fetch;
}

export async function verifyTurnstileToken(options: TurnstileOptions): Promise<TurnstileOutcome> {
  if (!options.secret) {
    return { ok: false, reason: "not_configured" };
  }
  if (!options.token || options.token.length > maxTokenLength) {
    return { ok: false, reason: "missing_token" };
  }
  const form = new FormData();
  form.set("secret", options.secret);
  form.set("response", options.token);
  form.set("remoteip", options.remoteIp);
  let payload: unknown;
  const timer = deadline(5000);
  try {
    const response = await (options.fetcher ?? fetch)(verifyEndpoint, {
      method: "POST",
      body: form,
      signal: timer.signal,
    });
    payload = await readLimitedJson(response, maxResponseBytes);
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    timer.clear();
  }
  const parsed = SiteverifyResponseSchema.safeParse(payload);
  if (!parsed.success || !parsed.data.success) {
    return { ok: false, reason: "rejected" };
  }
  if (options.expectedHostname && parsed.data.hostname !== options.expectedHostname) {
    return { ok: false, reason: "rejected" };
  }
  if (options.expectedAction && parsed.data.action !== options.expectedAction) {
    return { ok: false, reason: "rejected" };
  }
  return { ok: true };
}
