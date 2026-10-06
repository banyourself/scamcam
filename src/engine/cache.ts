export interface LookupCache {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

interface Breaker {
  failures: number;
  openUntil: number;
}

export interface LookupState {
  inflight: Map<string, Promise<unknown>>;
  breakers: Map<string, Breaker>;
  memory: Map<string, { value: unknown; expiresAt: number }>;
}

export interface Lookups {
  cache: LookupCache;
  state: LookupState;
  clock: () => number;
  sharedCacheCalls?: { remaining: number };
}

interface Envelope {
  v: 1;
  expiresAt: number;
  data: unknown;
}

const breakerThreshold = 3;
const breakerCooldownMs = 60_000;
const maxMemoryEntries = 5000;

export const sharedCacheCallsPerRequest = 20;

export function createLookupState(): LookupState {
  return { inflight: new Map(), breakers: new Map(), memory: new Map() };
}

export function memoryLookupCache(clock: () => number = Date.now, maxEntries = 2000): LookupCache {
  const entries = new Map<string, { value: unknown; expiresAt: number }>();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      if (entry.expiresAt <= clock()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    async put(key, value, ttlSeconds) {
      if (!entries.has(key) && entries.size >= maxEntries) {
        const oldest = entries.keys().next();
        if (!oldest.done) {
          entries.delete(oldest.value);
        }
      }
      entries.set(key, { value, expiresAt: clock() + ttlSeconds * 1000 });
    },
  };
}

export function memoryLookups(clock: () => number = Date.now): Lookups {
  return { cache: memoryLookupCache(clock), state: createLookupState(), clock };
}

export async function cacheKey(namespace: string, value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${namespace}\n${value}`)));
  return `${namespace}/${[...digest.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === "object" && value !== null && (value as Envelope).v === 1 && typeof (value as Envelope).expiresAt === "number" && "data" in value;
}

function takeSharedCacheCall(lookups: Lookups): boolean {
  const allowance = lookups.sharedCacheCalls;
  if (!allowance) {
    return true;
  }
  if (allowance.remaining <= 0) {
    return false;
  }
  allowance.remaining -= 1;
  return true;
}

export async function readCached<T>(lookups: Lookups, key: string, isValue: (value: unknown) => value is T): Promise<T | undefined> {
  const remembered = recallFromMemory(lookups, key);
  if (remembered !== undefined) {
    return isValue(remembered) ? remembered : undefined;
  }
  if (!takeSharedCacheCall(lookups)) {
    return undefined;
  }
  let stored: unknown;
  try {
    stored = await lookups.cache.get(key);
  } catch {
    return undefined;
  }
  if (!isEnvelope(stored) || stored.expiresAt <= lookups.clock() || !isValue(stored.data)) {
    return undefined;
  }
  rememberInMemory(lookups, key, stored.data, (stored.expiresAt - lookups.clock()) / 1000);
  return stored.data;
}

export async function writeCached(lookups: Lookups, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const seconds = Math.floor(ttlSeconds);
  if (!(seconds > 0)) {
    return;
  }
  rememberInMemory(lookups, key, value, seconds);
  if (!takeSharedCacheCall(lookups)) {
    return;
  }
  const envelope: Envelope = { v: 1, expiresAt: lookups.clock() + seconds * 1000, data: value };
  try {
    await lookups.cache.put(key, envelope, seconds);
  } catch {
    return;
  }
}

export function sharedLoad<T>(lookups: Lookups, key: string, load: () => Promise<T>): Promise<T> {
  const running = lookups.state.inflight.get(key);
  if (running) {
    return running as Promise<T>;
  }
  const promise = load().finally(() => lookups.state.inflight.delete(key));
  lookups.state.inflight.set(key, promise);
  return promise;
}

export async function cachedLookup<T>(
  lookups: Lookups,
  key: string,
  isValue: (value: unknown) => value is T,
  load: () => Promise<T>,
  ttlFor: (value: T) => number,
): Promise<{ value: T; cached: boolean }> {
  const hit = await readCached(lookups, key, isValue);
  if (hit !== undefined) {
    return { value: hit, cached: true };
  }
  return sharedLoad(lookups, key, async () => {
    const value = await load();
    await writeCached(lookups, key, value, ttlFor(value));
    return { value, cached: false };
  });
}

export function rememberInMemory(lookups: Lookups, key: string, value: unknown, ttlSeconds: number): void {
  const memory = lookups.state.memory;
  if (!memory.has(key) && memory.size >= maxMemoryEntries) {
    const oldest = memory.keys().next();
    if (!oldest.done) {
      memory.delete(oldest.value);
    }
  }
  memory.set(key, { value, expiresAt: lookups.clock() + ttlSeconds * 1000 });
}

export function recallFromMemory(lookups: Lookups, key: string): unknown {
  const entry = lookups.state.memory.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= lookups.clock()) {
    lookups.state.memory.delete(key);
    return undefined;
  }
  return entry.value;
}

export function sourceIsOpen(lookups: Lookups, source: string): boolean {
  const breaker = lookups.state.breakers.get(source);
  return !breaker || breaker.openUntil <= lookups.clock();
}

export function recordOutcome(lookups: Lookups, source: string, ok: boolean): void {
  const breaker = lookups.state.breakers.get(source) ?? { failures: 0, openUntil: 0 };
  if (ok) {
    breaker.failures = 0;
    breaker.openUntil = 0;
  } else {
    breaker.failures += 1;
    if (breaker.failures >= breakerThreshold) {
      breaker.failures = 0;
      breaker.openUntil = lookups.clock() + breakerCooldownMs;
    }
  }
  lookups.state.breakers.set(source, breaker);
}
