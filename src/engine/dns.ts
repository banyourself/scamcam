import { z } from "zod";

export const dohEndpoint = "https://cloudflare-dns.com/dns-query";

const DohSchema = z.object({
  Status: z.number(),
  Answer: z.array(z.object({ type: z.number(), data: z.string() })).optional(),
});

export type DnsResult = { status: "ok"; exists: boolean; addresses: string[] } | { status: "unavailable" };

export async function lookupDns(hostname: string, fetcher: typeof fetch): Promise<DnsResult> {
  try {
    const query = new URLSearchParams({ name: hostname, type: "A" });
    const response = await fetcher(`${dohEndpoint}?${query}`, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return { status: "unavailable" };
    }
    const parsed = DohSchema.safeParse(await response.json());
    if (!parsed.success) {
      return { status: "unavailable" };
    }
    if (parsed.data.Status === 3) {
      return { status: "ok", exists: false, addresses: [] };
    }
    if (parsed.data.Status !== 0) {
      return { status: "unavailable" };
    }
    const addresses = (parsed.data.Answer ?? []).filter((answer) => answer.type === 1).map((answer) => answer.data);
    return { status: "ok", exists: true, addresses };
  } catch {
    return { status: "unavailable" };
  }
}

export function isPrivateAddress(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
