import type { LookupCache } from "../engine/cache";

export const lookupCacheName = "scamcam-lookups";

export function edgeLookupCache(origin: string): LookupCache {
  let opened: Promise<Cache> | null = null;
  const cache = () => (opened ??= caches.open(lookupCacheName));
  const address = (key: string) => `${origin}/__internal/lookups/v1/${key}`;
  return {
    async get(key) {
      const response = await (await cache()).match(address(key));
      return response ? response.json() : undefined;
    },
    async put(key, value, ttlSeconds) {
      const response = new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${Math.floor(ttlSeconds)}` },
      });
      await (await cache()).put(address(key), response);
    },
  };
}
