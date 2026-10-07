import { describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { lookupSpamhaus, spamhausKeyIsValid, type DnsTransport } from "../../src/engine/spamhaus";
import { fakeSpamhaus } from "./fake-network";

const key = "testkey0123456789abcdefgh";

describe("Spamhaus DBL and ZRD lookups", () => {
  it("asks the DBL and ZRD zones once per domain, in one batch, with the key inside the name", async () => {
    const asked: string[][] = [];
    const transport = fakeSpamhaus({ "phish.example": { dbl: "127.0.1.4" }, "new.example": { zrd: "127.0.2.5" } }, asked);
    const results = await lookupSpamhaus(["phish.example", "new.example", "clean.example", "PHISH.example"], { key, transport, lookups: memoryLookups() });
    expect(asked).toEqual([
      [
        `phish.example.${key}.dbl.dq.spamhaus.net`,
        `phish.example.${key}.zrd.dq.spamhaus.net`,
        `new.example.${key}.dbl.dq.spamhaus.net`,
        `new.example.${key}.zrd.dq.spamhaus.net`,
        `clean.example.${key}.dbl.dq.spamhaus.net`,
        `clean.example.${key}.zrd.dq.spamhaus.net`,
      ],
    ]);
    expect(results.get("phish.example")).toEqual({ status: "ok", dbl: { kind: "phishing", abused: false }, zrd: null });
    expect(results.get("new.example")).toEqual({ status: "ok", dbl: null, zrd: { hoursAgo: 5 } });
    expect(results.get("clean.example")).toEqual({ status: "ok", dbl: null, zrd: null });
  });

  it("reads every DBL code and keeps the most serious one", async () => {
    const codes: Record<string, { kind: string; abused: boolean }> = {
      "127.0.1.2": { kind: "spam", abused: false },
      "127.0.1.5": { kind: "malware", abused: false },
      "127.0.1.6": { kind: "botnet", abused: false },
      "127.0.1.102": { kind: "spam", abused: true },
      "127.0.1.103": { kind: "redirector", abused: true },
      "127.0.1.104": { kind: "phishing", abused: true },
      "127.0.1.105": { kind: "malware", abused: true },
      "127.0.1.106": { kind: "botnet", abused: true },
    };
    for (const [code, listing] of Object.entries(codes)) {
      const results = await lookupSpamhaus(["listed.example"], { key, transport: fakeSpamhaus({ "listed.example": { dbl: code } }), lookups: memoryLookups() });
      expect(results.get("listed.example"), code).toEqual({ status: "ok", dbl: listing, zrd: null });
    }
    const both: DnsTransport = {
      async resolve(names) {
        return names.map((name) => (name.includes(".dbl.") ? { status: "answered", rcode: 0, addresses: ["127.0.1.103", "127.0.1.4"] } : { status: "answered", rcode: 3, addresses: [] }));
      },
    };
    const results = await lookupSpamhaus(["both.example"], { key, transport: both, lookups: memoryLookups() });
    expect(results.get("both.example")).toEqual({ status: "ok", dbl: { kind: "phishing", abused: false }, zrd: null });
  });

  it("treats error codes, server failures, and missing answers as not checked, never as clean", async () => {
    for (const entry of [{ dbl: "127.255.255.254" }, { dbl: "127.255.255.255" }, { dbl: "127.0.1.255" }, { zrd: "127.0.2.255" }, { dbl: "127.0.9.9" }, { rcode: 2 }, { rcode: 5 }]) {
      const results = await lookupSpamhaus(["odd.example"], { key, transport: fakeSpamhaus({ "odd.example": entry }), lookups: memoryLookups() });
      expect(results.get("odd.example"), JSON.stringify(entry)).toEqual({ status: "unavailable" });
    }
    const down = await lookupSpamhaus(["down.example"], { key, transport: fakeSpamhaus({}, [], true), lookups: memoryLookups() });
    expect(down.get("down.example")).toEqual({ status: "unavailable" });
    const throwing: DnsTransport = {
      async resolve() {
        throw new Error("socket closed");
      },
    };
    expect((await lookupSpamhaus(["x.example"], { key, transport: throwing, lookups: memoryLookups() })).get("x.example")).toEqual({ status: "unavailable" });
  });

  it("never sends a malformed key or name, and skips IP addresses", async () => {
    expect(spamhausKeyIsValid(key)).toBe(true);
    expect(spamhausKeyIsValid("short")).toBe(false);
    expect(spamhausKeyIsValid("abc.def.ghi0123456789")).toBe(false);
    expect(spamhausKeyIsValid(undefined)).toBe(false);
    const asked: string[][] = [];
    const transport = fakeSpamhaus({}, asked);
    const badKey = await lookupSpamhaus(["fine.example"], { key: "evil.attacker.example.zone", transport, lookups: memoryLookups() });
    expect(badKey.get("fine.example")).toEqual({ status: "unavailable" });
    const odd = await lookupSpamhaus(["203.0.113.5", "bad name.example", "a..b", `${"x".repeat(170)}.example`], { key, transport, lookups: memoryLookups() });
    expect(odd.size).toBe(0);
    expect(asked).toEqual([]);
  });

  it("remembers answers for a minute so a repeated scan sends nothing", async () => {
    const asked: string[][] = [];
    let now = Date.parse("2026-10-06T12:00:00Z");
    const lookups = memoryLookups(() => now);
    const transport = fakeSpamhaus({ "phish.example": { dbl: "127.0.1.4" } }, asked);
    await lookupSpamhaus(["phish.example"], { key, transport, lookups });
    await lookupSpamhaus(["phish.example"], { key, transport, lookups });
    expect(asked).toHaveLength(1);
    now += 61_000;
    await lookupSpamhaus(["phish.example"], { key, transport, lookups });
    expect(asked).toHaveLength(2);
  });
});
