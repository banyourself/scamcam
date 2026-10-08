import { isBreachNotices, isSiteSecurity, type BreachNotices, type SiteSecurity } from "../../shared/site-data";

type Fetcher = typeof fetch;
const defaultFetcher: Fetcher = (input, init) => fetch(input, init);

export async function loadGzipJson(path: string, fetcher: Fetcher = defaultFetcher): Promise<unknown> {
  try {
    const response = await fetcher(path, { headers: { Accept: "application/gzip" } });
    if (!response.ok || !response.body || !(response.headers.get("Content-Type") ?? "").includes("application/gzip")) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json();
  } catch {
    return null;
  }
}

export async function loadSiteSecurity(fetcher: Fetcher = defaultFetcher): Promise<SiteSecurity | null> {
  const data = await loadGzipJson("/api/v1/site-security", fetcher);
  return isSiteSecurity(data) ? data : null;
}

export async function loadBreachNotices(fetcher: Fetcher = defaultFetcher): Promise<BreachNotices | null> {
  const data = await loadGzipJson("/api/v1/breach-notices", fetcher);
  return isBreachNotices(data) ? data : null;
}
