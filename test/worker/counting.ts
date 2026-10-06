import { memoryLookupCache, type LookupCache } from "../../src/engine/cache";

export const freePlanSubrequestLimit = 50;

export function countingDatabase(db: D1Database, counter: { queries: number }): D1Database {
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...values: unknown[]) => wrap(target.bind(...values));
        }
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") {
          return value;
        }
        if (property === "first" || property === "run" || property === "all" || property === "raw") {
          return (...args: unknown[]) => {
            counter.queries += 1;
            return (value as (...parts: unknown[]) => unknown).apply(target, args);
          };
        }
        return (value as (...parts: unknown[]) => unknown).bind(target);
      },
    });
  return new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => wrap(target.prepare(sql));
      }
      if (property === "batch") {
        return () => {
          throw new Error("batch is not counted by this helper");
        };
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? (value as (...parts: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export function countingCache(): { cache: LookupCache; counter: { calls: number } } {
  const inner = memoryLookupCache();
  const counter = { calls: 0 };
  return {
    counter,
    cache: {
      get: (key) => {
        counter.calls += 1;
        return inner.get(key);
      },
      put: (key, value, ttlSeconds) => {
        counter.calls += 1;
        return inner.put(key, value, ttlSeconds);
      },
    },
  };
}
