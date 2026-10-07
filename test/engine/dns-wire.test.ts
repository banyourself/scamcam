import { describe, expect, it } from "vitest";
import { decodeDnsReply, encodeDnsQuery, isDnsName } from "../../src/engine/dns-wire";

function reply(id: number, options: { rcode?: number; truncated?: boolean; addresses?: string[]; compressed?: boolean } = {}): Uint8Array {
  const question = encodeDnsQuery(id, "dbltest.com.examplekey0123456789.dbl.dq.spamhaus.net").subarray(12);
  const answers = (options.addresses ?? []).map((address) => {
    const name = options.compressed === false ? [...question.subarray(0, question.length - 4)] : [0xc0, 0x0c];
    return [...name, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, ...address.split(".").map(Number)];
  });
  const flags = 0x8000 | 0x0400 | (options.truncated ? 0x0200 : 0) | (options.rcode ?? 0);
  return Uint8Array.from([id >> 8, id & 0xff, flags >> 8, flags & 0xff, 0, 1, 0, answers.length, 0, 0, 0, 0, ...question, ...answers.flat()]);
}

describe("DNS wire format", () => {
  it("writes one A question without asking for recursion", () => {
    const query = encodeDnsQuery(0x1234, "dbltest.com.k.dbl.dq.spamhaus.net");
    expect([...query.subarray(0, 12)]).toEqual([0x12, 0x34, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
    expect(new TextDecoder().decode(query.subarray(13, 20))).toBe("dbltest");
    expect([...query.subarray(-4)]).toEqual([0, 1, 0, 1]);
  });

  it("refuses names that could escape the zone or break the message", () => {
    for (const name of ["", "a..b", "-bad.example", "bad-.example", `${"a".repeat(64)}.example`, `${"abcdefghi.".repeat(26)}com`, "evil.example.", "space here.example", "semi;colon.example"]) {
      expect(isDnsName(name), name).toBe(false);
      expect(() => encodeDnsQuery(1, name)).toThrow(RangeError);
    }
    expect(() => encodeDnsQuery(70_000, "ok.example")).toThrow(RangeError);
    expect(isDnsName("xn--80ak6aa92e.com")).toBe(true);
  });

  it("reads answers with and without name compression", () => {
    expect(decodeDnsReply(reply(7, { addresses: ["127.0.1.4"] }))).toEqual({ id: 7, rcode: 0, truncated: false, addresses: ["127.0.1.4"] });
    expect(decodeDnsReply(reply(8, { addresses: ["127.0.1.2", "127.0.1.104"], compressed: false }))?.addresses).toEqual(["127.0.1.2", "127.0.1.104"]);
    expect(decodeDnsReply(reply(9, { rcode: 3 }))).toEqual({ id: 9, rcode: 3, truncated: false, addresses: [] });
    expect(decodeDnsReply(reply(10, { truncated: true }))?.truncated).toBe(true);
  });

  it("rejects queries, short messages, and records that run past the end", () => {
    expect(decodeDnsReply(encodeDnsQuery(1, "a.example"))).toBeNull();
    expect(decodeDnsReply(new Uint8Array(5))).toBeNull();
    const cut = reply(11, { addresses: ["127.0.1.4"] });
    expect(decodeDnsReply(cut.subarray(0, cut.length - 2))).toBeNull();
    const reservedLabel = Uint8Array.from([0, 1, 0x80, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x45, 0x61, 0, 0, 1, 0, 1]);
    expect(decodeDnsReply(reservedLabel)).toBeNull();
    const endless = Uint8Array.from([0, 1, 0x80, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...Array.from({ length: 70 }, () => [1, 0x61]).flat()]);
    expect(decodeDnsReply(endless)).toBeNull();
  });
});
