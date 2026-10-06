import { describe, expect, it } from "vitest";
import { cacheKey, memoryLookupCache, memoryLookups, readCached, writeCached } from "../../src/engine/cache";
import { dohEndpoint, lookupDns } from "../../src/engine/dns";
import { lookupRdap, rdapBootstrapUrl } from "../../src/engine/rdap";
import { lookupUrlhausHost, urlhausHostEndpoint } from "../../src/engine/urlhaus";

function counter(respond: (url: string) => Response) {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    return respond(url);
  };
  return { fetcher, calls };
}

const bootstrap = { services: [[["example"], ["https://rdap.registry.test/"]]] };

function rdapNetwork(domainResponse: () => Response) {
  return counter((url) => (url === rdapBootstrapUrl ? Response.json(bootstrap) : domainResponse()));
}

const isAnything = (value: unknown): value is unknown => value !== undefined;

describe("lookup cache", () => {
  it("never puts the looked-up name into the cache key", async () => {
    const key = await cacheKey("dns-a", "secret-token.example.com");
    expect(key).not.toContain("secret");
    expect(key).not.toContain("example");
    expect(key).toMatch(/^dns-a\/[0-9a-f]{32}$/);
  });

  it("ignores entries that are expired or have the wrong shape", async () => {
    let now = 1_000;
    const lookups = memoryLookups(() => now);
    await writeCached(lookups, "a", { fine: true }, 10);
    expect(await readCached(lookups, "a", isAnything)).toEqual({ fine: true });
    await lookups.cache.put("b", { v: 1, expiresAt: now - 1, data: 1 }, 60);
    expect(await readCached(lookups, "b", isAnything)).toBeUndefined();
    await lookups.cache.put("c", { something: "else" }, 60);
    expect(await readCached(lookups, "c", isAnything)).toBeUndefined();
    now += 11_000;
    expect(await readCached(lookups, "a", isAnything)).toBeUndefined();
  });

  it("keeps working when the cache itself fails", async () => {
    const lookups = { ...memoryLookups(), cache: { get: async () => Promise.reject(new Error("down")), put: async () => Promise.reject(new Error("down")) } };
    await writeCached(lookups, "a", 1, 60);
    expect(await readCached(lookups, "a", isAnything)).toBeUndefined();
  });

  it("drops the oldest entry when the memory cache is full", async () => {
    const cache = memoryLookupCache(Date.now, 2);
    await cache.put("one", 1, 60);
    await cache.put("two", 2, 60);
    await cache.put("three", 3, 60);
    expect(await cache.get("one")).toBeUndefined();
    expect(await cache.get("three")).toBe(3);
  });
});

describe("RDAP caching", () => {
  it("reuses registry answers and the bootstrap file", async () => {
    const lookups = memoryLookups();
    const network = rdapNetwork(() => Response.json({ events: [{ eventAction: "registration", eventDate: "2020-01-01T00:00:00Z" }] }));
    const first = await lookupRdap("shop.example", network.fetcher, lookups);
    const second = await lookupRdap("shop.example", network.fetcher, lookups);
    expect(first).toEqual(second);
    expect(network.calls).toEqual([rdapBootstrapUrl, "https://rdap.registry.test/domain/shop.example"]);
  });

  it("remembers unregistered domains for an hour", async () => {
    let now = 0;
    const lookups = memoryLookups(() => now);
    const network = rdapNetwork(() => new Response("{}", { status: 404 }));
    expect(await lookupRdap("gone.example", network.fetcher, lookups)).toEqual({ status: "not_found" });
    now += 59 * 60_000;
    await lookupRdap("gone.example", network.fetcher, lookups);
    expect(network.calls.filter((url) => url.includes("domain/"))).toHaveLength(1);
    now += 2 * 60_000;
    await lookupRdap("gone.example", network.fetcher, lookups);
    expect(network.calls.filter((url) => url.includes("domain/"))).toHaveLength(2);
  });

  it("backs off from a registry that answers too many requests for as long as it asks", async () => {
    let now = 0;
    const lookups = memoryLookups(() => now);
    const network = rdapNetwork(() => new Response("slow down", { status: 429, headers: { "Retry-After": "120" } }));
    expect(await lookupRdap("one.example", network.fetcher, lookups)).toEqual({ status: "unavailable" });
    expect(await lookupRdap("two.example", network.fetcher, lookups)).toEqual({ status: "unavailable" });
    expect(network.calls.filter((url) => url.includes("domain/"))).toHaveLength(1);
    now += 121_000;
    await lookupRdap("two.example", network.fetcher, lookups);
    expect(network.calls.filter((url) => url.includes("domain/"))).toHaveLength(2);
  });

  it("does not cache failures", async () => {
    const lookups = memoryLookups();
    const network = rdapNetwork(() => new Response("oops", { status: 500 }));
    await lookupRdap("flaky.example", network.fetcher, lookups);
    await lookupRdap("flaky.example", network.fetcher, lookups);
    expect(network.calls.filter((url) => url.includes("domain/"))).toHaveLength(2);
  });
});

describe("DNS caching", () => {
  it("keeps an answer for its time to live", async () => {
    let now = 0;
    const lookups = memoryLookups(() => now);
    const network = counter(() => Response.json({ Status: 0, Answer: [{ type: 1, data: "203.0.113.5", TTL: 120 }] }));
    await lookupDns("www.shop.example", network.fetcher, lookups);
    now += 119_000;
    await lookupDns("www.shop.example", network.fetcher, lookups);
    expect(network.calls).toHaveLength(1);
    now += 2_000;
    await lookupDns("www.shop.example", network.fetcher, lookups);
    expect(network.calls).toHaveLength(2);
    expect(network.calls[0]!.startsWith(dohEndpoint)).toBe(true);
  });

  it("keeps a missing name for at least a minute and at most fifteen", async () => {
    let now = 0;
    const lookups = memoryLookups(() => now);
    const network = counter(() => Response.json({ Status: 3, Authority: [{ type: 6, data: "soa", TTL: 5 }] }));
    expect(await lookupDns("nothing.example", network.fetcher, lookups)).toEqual({ status: "ok", exists: false, addresses: [] });
    now += 59_000;
    await lookupDns("nothing.example", network.fetcher, lookups);
    expect(network.calls).toHaveLength(1);
    now += 2_000;
    await lookupDns("nothing.example", network.fetcher, lookups);
    expect(network.calls).toHaveLength(2);
  });
});

describe("URLhaus caching", () => {
  const options = (fetcher: typeof fetch, lookups = memoryLookups(), takeBudget = async () => true) => ({ authKey: "key", fetcher, lookups, takeBudget });

  it("keeps answers for fifteen minutes and takes from the budget only when asking", async () => {
    let now = 0;
    const lookups = memoryLookups(() => now);
    let taken = 0;
    const takeBudget = async () => {
      taken += 1;
      return true;
    };
    const network = counter(() => Response.json({ query_status: "no_results" }));
    await lookupUrlhausHost("files.example", options(network.fetcher, lookups, takeBudget));
    now += 14 * 60_000;
    await lookupUrlhausHost("files.example", options(network.fetcher, lookups, takeBudget));
    expect(network.calls).toEqual([urlhausHostEndpoint]);
    expect(taken).toBe(1);
    now += 2 * 60_000;
    await lookupUrlhausHost("files.example", options(network.fetcher, lookups, takeBudget));
    expect(network.calls).toHaveLength(2);
  });

  it("reports a used-up budget without calling", async () => {
    const network = counter(() => Response.json({ query_status: "no_results" }));
    expect(await lookupUrlhausHost("files.example", options(network.fetcher, memoryLookups(), async () => false))).toEqual({ status: "over_budget" });
    expect(network.calls).toHaveLength(0);
  });

  it("does not cache failures", async () => {
    const lookups = memoryLookups();
    const network = counter(() => Response.json({ query_status: "unknown_auth_key" }));
    expect(await lookupUrlhausHost("files.example", options(network.fetcher, lookups))).toEqual({ status: "unavailable" });
    await lookupUrlhausHost("files.example", options(network.fetcher, lookups));
    expect(network.calls).toHaveLength(2);
  });
});
