import type { BreachCatalog } from "../../shared/api";
import { isBreachCatalog } from "../../shared/breaches";
import { rangeCounts } from "../../shared/passwords";

export type PasswordResult = { status: "found"; count: number } | { status: "not_found" } | { status: "rate_limited" } | { status: "unavailable" };

export async function sha1Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function checkPassword(password: string, fetcher: typeof fetch = (input, init) => fetch(input, init)): Promise<PasswordResult> {
  const hash = await sha1Hex(password);
  let response: Response;
  try {
    response = await fetcher(`/api/v1/passwords/range/${hash.slice(0, 5)}`, { headers: { Accept: "text/plain" }, cache: "no-store", referrerPolicy: "no-referrer" });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 429) {
    return { status: "rate_limited" };
  }
  if (!response.ok) {
    return { status: "unavailable" };
  }
  const count = rangeCounts(await response.text()).get(hash.slice(5));
  return count ? { status: "found", count } : { status: "not_found" };
}

export async function loadBreachCatalog(fetcher: typeof fetch = (input, init) => fetch(input, init)): Promise<BreachCatalog | null> {
  try {
    const response = await fetcher("/api/v1/breaches", { headers: { Accept: "application/json" } });
    if (!response.ok) {
      return null;
    }
    const body: unknown = await response.json();
    return isBreachCatalog(body) ? body : null;
  } catch {
    return null;
  }
}
