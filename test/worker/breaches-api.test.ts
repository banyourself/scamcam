import { createExecutionContext, env, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compactCatalog, hibpBreachesEndpoint } from "../../src/engine/breach-catalog";
import { memoryLookupCache, type LookupCache } from "../../src/engine/cache";
import { pwnedPasswordsEndpoint } from "../../src/engine/pwned-passwords";
import type { BreachCatalog } from "../../src/shared/api";
import { createApp, type AppOptions } from "../../src/worker/app";
import { BreachKeeper, breachStorageKey } from "../../src/worker/breach-keeper";
import { scannerName, type Scanner } from "../../src/worker/scanner";
import { fakeNetwork, type FakeNetworkOptions } from "../engine/fake-network";
import { rawBreachList } from "../fixtures/hibp-breaches";
import { countingCache } from "./counting";

const origin = "https://scamcam.kevinle.tech";
const range = `003D68EB55068C33ACE09247EE4C639306B:3\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:52372427\r\n`;
let nextAddress = 1;

async function get(path: string, network: FakeNetworkOptions = {}, options: Partial<AppOptions> & { ip?: string } = {}) {
  const fake = fakeNetwork(network);
  const app = createApp({ fetcher: fake.fetcher, lookupCache: options.lookupCache ?? memoryLookupCache(), ...options });
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${origin}${path}`, { headers: { "CF-Connecting-IP": options.ip ?? `203.0.113.${(nextAddress++ % 200) + 1}` } }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { response, fake };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("password range endpoint", () => {
  it("passes on the range for a valid prefix with padding and API security headers", async () => {
    const { response, fake } = await get("/api/v1/passwords/range/5baa6", { passwordRanges: { "5BAA6": range } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-transform");
    expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const body = await response.text();
    expect(body.startsWith(range)).toBe(true);
    expect(body.split("\n").every((line) => /^[0-9A-F]{35}:\d+\r?$/.test(line))).toBe(true);
    expect(fake.requests.map((request) => request.url)).toEqual([`${pwnedPasswordsEndpoint}5BAA6`]);
    expect(fake.requests[0]!.headers.get("Add-Padding")).toBe("true");
    expect(fake.requests[0]!.headers.has("CF-Connecting-IP")).toBe(false);
  });

  it.each(["5baa", "5baa61", "zzzzz", "5BAA6%0A", "..%2F.."])("refuses the prefix %s without asking anyone", async (prefix) => {
    const { response, fake } = await get(`/api/v1/passwords/range/${prefix}`);
    expect([400, 404]).toContain(response.status);
    expect(fake.requests).toHaveLength(0);
  });

  it("says when Pwned Passwords did not answer", async () => {
    const { response } = await get("/api/v1/passwords/range/5BAA6", { passwordStatus: 503 });
    expect(response.status).toBe(503);
    expect((await response.json<{ error: { code: string } }>()).error.code).toBe("unavailable");
  });

  it("answers a repeat from the edge cache, within three subrequests, and logs no prefix", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { cache, counter } = countingCache();
    const first = await get("/api/v1/passwords/range/ABCDE", { passwordRanges: { ABCDE: range } }, { lookupCache: cache });
    expect(first.response.status).toBe(200);
    expect(first.fake.requests.length + counter.calls).toBeLessThanOrEqual(3);
    const second = await get("/api/v1/passwords/range/ABCDE", { passwordRanges: { ABCDE: range } }, { lookupCache: cache });
    expect(second.response.status).toBe(200);
    expect(second.fake.requests).toHaveLength(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain("ABCDE");
    expect(JSON.stringify(log.mock.calls)).toContain("/api/v1/passwords/range/:prefix");
  });

  it("limits each visitor to 20 password checks a minute", async () => {
    const lookupCache = memoryLookupCache();
    const statuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      const { response } = await get("/api/v1/passwords/range/BCDEF", { passwordRanges: { BCDEF: range } }, { lookupCache, ip: "198.18.0.77" });
      statuses.push(response.status);
      if (response.status === 429) {
        expect(response.headers.get("Retry-After")).toBe("60");
      }
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe("breach list endpoint", () => {
  it("serves a compact copy of Have I Been Pwned's list and keeps it at the edge", async () => {
    const lookupCache = memoryLookupCache();
    const first = await get("/api/v1/breaches", { breaches: rawBreachList() }, { lookupCache });
    expect(first.response.status).toBe(200);
    const catalog = await first.response.json<BreachCatalog>();
    expect(catalog.breaches).toHaveLength(117);
    expect(catalog.breaches.find((entry) => entry.name === "Adobe")?.domain).toBe("adobe.com");
    expect(first.fake.requests.map((request) => request.url)).toEqual([hibpBreachesEndpoint]);
    const second = await get("/api/v1/breaches", { breaches: rawBreachList() }, { lookupCache });
    expect(second.response.status).toBe(200);
    expect(second.fake.requests).toHaveLength(0);
  });

  it("answers 503 when the list cannot be loaded, and tries again next time", async () => {
    const lookupCache = memoryLookupCache();
    const failed = await get("/api/v1/breaches", { breachesStatus: 503 }, { lookupCache });
    expect(failed.response.status).toBe(503);
    const next = await get("/api/v1/breaches", { breaches: rawBreachList() }, { lookupCache });
    expect(next.response.status).toBe(200);
    expect(next.fake.requests).toHaveLength(1);
  });

  it("asks the scanner for the list when one is bound, and stays within three subrequests", async () => {
    const stored = compactCatalog(rawBreachList(), new Date())!;
    const breachCatalog = vi.fn(async () => stored);
    const scanner = { idFromName: () => ({}), get: () => ({ breachCatalog }) } as unknown as typeof env.SCANNER;
    const fake = fakeNetwork({ breaches: rawBreachList() });
    const { cache, counter } = countingCache();
    const app = createApp({ fetcher: fake.fetcher, lookupCache: cache as LookupCache, scans: "scanner" });
    const ctx = createExecutionContext();
    const response = await app.fetch(new Request(`${origin}/api/v1/breaches`, { headers: { "CF-Connecting-IP": "203.0.113.250" } }), { ...env, SCANNER: scanner }, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(breachCatalog).toHaveBeenCalledTimes(1);
    expect(fake.requests).toHaveLength(0);
    expect(counter.calls + 1).toBeLessThanOrEqual(3);
  });
});

function memoryStorage(initial?: BreachCatalog) {
  const values = new Map<string, unknown>(initial ? [[breachStorageKey, initial]] : []);
  const writes: string[] = [];
  return {
    values,
    writes,
    storage: {
      get: async (key: string) => values.get(key),
      put: async (key: string, value: BreachCatalog) => {
        writes.push(key);
        values.set(key, value);
      },
    },
  };
}

describe("the scanner's copy of the breach list", () => {
  const hour = 60 * 60 * 1000;
  const start = Date.parse("2026-10-08T12:00:00.000Z");

  it("uses a fresh stored copy without asking Have I Been Pwned", async () => {
    const { storage } = memoryStorage(compactCatalog(rawBreachList(), new Date(start - 2 * hour))!);
    const fake = fakeNetwork({ breaches: rawBreachList() });
    const keeper = new BreachKeeper(storage, fake.fetcher, () => start);
    expect((await keeper.current())?.breaches).toHaveLength(117);
    expect((await keeper.index())?.has("adobe.com")).toBe(true);
    expect(fake.requests).toHaveLength(0);
  });

  it("refreshes a copy older than 12 hours once, even when asked twice at the same time, and stores it", async () => {
    const { storage, writes } = memoryStorage(compactCatalog(rawBreachList(), new Date(start - 13 * hour))!);
    const fake = fakeNetwork({ breaches: rawBreachList() });
    const keeper = new BreachKeeper(storage, fake.fetcher, () => start);
    const [first, second] = await Promise.all([keeper.current(), keeper.current()]);
    expect(first?.fetchedAt).toBe(new Date(start).toISOString());
    expect(second).toBe(first);
    expect(fake.requests).toHaveLength(1);
    expect(writes).toEqual([breachStorageKey]);
  });

  it("keeps using a copy up to a week old when the refresh fails, and none after that", async () => {
    const { storage } = memoryStorage(compactCatalog(rawBreachList(), new Date(start - 3 * 24 * hour))!);
    let now = start;
    const keeper = new BreachKeeper(storage, fakeNetwork({ breachesStatus: 503 }).fetcher, () => now);
    expect(await keeper.current()).not.toBeNull();
    expect(await keeper.index()).toBeDefined();
    now = start + 5 * 24 * hour;
    expect(await keeper.current()).toBeNull();
    expect(await keeper.index()).toBeUndefined();
  });

  it("never fetches anything while scanning", async () => {
    const { storage } = memoryStorage();
    const fake = fakeNetwork({ breaches: rawBreachList() });
    const keeper = new BreachKeeper(storage, fake.fetcher, () => start);
    expect(await keeper.index()).toBeUndefined();
    expect(fake.requests).toHaveLength(0);
  });

  it("adds the breach line to scans in the Durable Object from its stored copy", async () => {
    const offline = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("offline", { status: 404 }));
    const stub = env.SCANNER.get(env.SCANNER.idFromName(`${scannerName}-breach-test`));
    await runInDurableObject(stub, async (instance: Scanner, state) => {
      await state.storage.put(breachStorageKey, compactCatalog(rawBreachList(), new Date())!);
      const outcome = await instance.scan("is this real? https://www.roblox.com/home");
      expect(outcome.report.evidence.map((item) => item.id)).toContain("breach-roblox.com");
      expect((await instance.breachCatalog())?.breaches).toHaveLength(117);
    });
    const asked = offline.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input));
    expect(asked.some((url) => url.includes("haveibeenpwned.com"))).toBe(false);
  });
});
