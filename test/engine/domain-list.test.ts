import { describe, expect, it } from "vitest";
import {
  buildShards,
  candidateNames,
  domainListKey,
  domainListShardCount,
  normalizeListEntry,
  normalizePhoneEntry,
  shardContains,
  shardOf,
} from "../../src/engine/domain-list";
import { domainListStatements, maxStatementBytes } from "../../src/worker/repositories/domain-list-sql";

const names = Array.from({ length: 3000 }, (_, index) => `listed-${index}.example`);

describe("domain list entries", () => {
  it.each([
    ["Steam-Gift.Example.", "steam-gift.example"],
    ["  login.xn--stam-gift-7ya.example  ", "login.xn--stam-gift-7ya.example"],
    ["# a comment", null],
    ["! adblock comment", null],
    ["", null],
    ["not a domain", null],
    ["under_score.example", "under_score.example"],
    ["101.0.81.153", "101.0.81.153"],
    ["256.1.1.1", null],
    ["01.2.3.4", null],
    ["-leading.example", null],
    ["localhost", null],
    [`${"a".repeat(64)}.example`, null],
  ])("normalizes %j to %j", (line, expected) => {
    expect(normalizeListEntry(line)).toBe(expected);
  });
});

describe("domain list shards", () => {
  it("finds every listed name and nothing else", async () => {
    const shards = await buildShards(names);
    expect(shards).toHaveLength(domainListShardCount);
    expect(shards.reduce((total, shard) => total + shard.length / 8, 0)).toBe(names.length);
    for (const name of names.slice(0, 500)) {
      const key = await domainListKey(name);
      expect(shardContains(shards[shardOf(key)]!, key)).toBe(true);
    }
    for (let index = 0; index < 500; index += 1) {
      const key = await domainListKey(`not-listed-${index}.example`);
      expect(shardContains(shards[shardOf(key)]!, key)).toBe(false);
    }
  });

  it("stores each key once, in order", async () => {
    const shards = await buildShards([...names.slice(0, 200), ...names.slice(0, 200)]);
    expect(shards.reduce((total, shard) => total + shard.length / 8, 0)).toBe(200);
    const ascending = (previous: Uint8Array, current: Uint8Array) => {
      const index = previous.findIndex((byte, position) => byte !== current[position]);
      return index >= 0 && previous[index]! < current[index]!;
    };
    for (const shard of shards) {
      for (let offset = 8; offset < shard.length; offset += 8) {
        expect(ascending(shard.slice(offset - 8, offset), shard.slice(offset, offset + 8))).toBe(true);
      }
    }
  });

  it("handles an empty shard", async () => {
    const key = await domainListKey("anything.example");
    expect(shardContains(new Uint8Array(), key)).toBe(false);
  });
});

describe("names checked for a link", () => {
  it.each([
    ["login.evil-trade.example", "evil-trade.example", ["login.evil-trade.example", "evil-trade.example"]],
    ["evil-trade.example", "evil-trade.example", ["evil-trade.example"]],
    ["a.b.c.shop.co.uk", "shop.co.uk", ["a.b.c.shop.co.uk", "b.c.shop.co.uk", "c.shop.co.uk", "shop.co.uk"]],
    ["steam-gift.pages.dev", "steam-gift.pages.dev", ["steam-gift.pages.dev"]],
    ["203.0.113.9", null, ["203.0.113.9"]],
  ])("checks %s against the list as %j", (host, registrable, expected) => {
    expect(candidateNames(host, registrable)).toEqual(expected);
  });
});

describe("domain list SQL", () => {
  it("writes every shard and then the list record", async () => {
    const statements = domainListStatements({ list: "phishing_database", version: "abc123", syncedAt: 100, expiresAt: 200, shards: await buildShards(names) });
    expect(statements).toHaveLength(domainListShardCount + 1);
    expect(statements.at(-1)).toContain("INSERT INTO domain_lists");
    expect(statements.at(-1)).toContain("3000");
    expect(statements.every((statement) => statement.length <= maxStatementBytes)).toBe(true);
  });

  it("refuses unsafe versions and oversized shards", async () => {
    const shards = await buildShards(names.slice(0, 10));
    expect(() => domainListStatements({ list: "phishing_database", version: "x'); DROP TABLE domain_lists; --", syncedAt: 1, expiresAt: 2, shards })).toThrow(RangeError);
    const huge = new Uint8Array(8 * 7000);
    expect(() => domainListStatements({ list: "phishing_database", version: "v1", syncedAt: 1, expiresAt: 2, shards: [huge] })).toThrow(RangeError);
    expect(() => domainListStatements({ list: "phishing_database", version: "v1", syncedAt: 1.5, expiresAt: 2, shards })).toThrow(RangeError);
  });
});

describe("phone list entries", () => {
  it("normalizes US numbers in any common form and refuses everything else", () => {
    for (const entry of ["4695550147", "14695550147", "+1 (469) 555-0147", "469.555.0147", " 469-555-0147 "]) {
      expect(normalizePhoneEntry(entry), entry).toBe("+14695550147");
    }
    for (const entry of ["0695550147", "4691550147", "24695550147", "469555014", "+44 20 7946 0958", "not a number", ""]) {
      expect(normalizePhoneEntry(entry), entry).toBeNull();
    }
  });
});
