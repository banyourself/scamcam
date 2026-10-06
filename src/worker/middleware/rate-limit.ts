import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { apiError } from "../errors";

export function clientAddress(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function ipv6Groups(address: string): string[] | null {
  const [head = "", tail, extra] = address.toLowerCase().split("::");
  if (extra !== undefined) {
    return null;
  }
  const parts = (text: string) => (text === "" ? [] : text.split(":"));
  const left = parts(head);
  const right = tail === undefined ? [] : parts(tail);
  const last = right.at(-1) ?? left.at(-1);
  if (last?.includes(".")) {
    const octets = last.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
      return null;
    }
    const mapped = [((octets[0]! << 8) | octets[1]!).toString(16), ((octets[2]! << 8) | octets[3]!).toString(16)];
    (right.length > 0 ? right : left).splice(-1, 1, ...mapped);
  }
  const missing = 8 - left.length - right.length;
  if ((tail === undefined && missing !== 0) || (tail !== undefined && missing < 1)) {
    return null;
  }
  const groups = [...left, ...Array.from({ length: tail === undefined ? 0 : missing }, () => "0"), ...right];
  return groups.every((group) => /^[0-9a-f]{1,4}$/.test(group)) ? groups.map((group) => group.padStart(4, "0")) : null;
}

export function rateLimitKey(request: Request): string {
  const address = clientAddress(request);
  if (!address.includes(":")) {
    return address;
  }
  const groups = ipv6Groups(address);
  if (!groups) {
    return address;
  }
  if (groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff") {
    return groups.slice(6).flatMap((group) => [Number.parseInt(group.slice(0, 2), 16), Number.parseInt(group.slice(2), 16)]).join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

export const rateLimitApi: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { success } = await c.env.API_RATE_LIMITER.limit({ key: rateLimitKey(c.req.raw) });
  if (!success) {
    c.header("Retry-After", "60");
    return apiError(c, 429);
  }
  await next();
};
