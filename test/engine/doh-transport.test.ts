import { describe, expect, it } from "vitest";
import { dohTransport } from "../../src/engine/doh-transport";
import { decodeDnsReply } from "../../src/engine/dns-wire";

interface Seen {
  url: string;
  method: string;
  contentType: string | null;
  query: Uint8Array;
}

function nameOf(query: Uint8Array): string {
  const labels: string[] = [];
  let offset = 12;
  while (query[offset]) {
    const length = query[offset]!;
    labels.push(new TextDecoder().decode(query.subarray(offset + 1, offset + 1 + length)));
    offset += length + 1;
  }
  return labels.join(".");
}

function replyFor(query: Uint8Array, options: { addresses?: string[]; rcode?: number; truncated?: boolean } = {}): Uint8Array {
  const question = query.subarray(12);
  const answers = (options.addresses ?? []).flatMap((address) => [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, ...address.split(".").map(Number)]);
  const flags = 0x8180 | (options.truncated ? 0x0200 : 0) | (options.rcode ?? 0);
  return Uint8Array.from([0, 0, flags >> 8, flags & 0xff, 0, 1, 0, (options.addresses ?? []).length, 0, 0, 0, 0, ...question, ...answers]);
}

function resolver(answer: (name: string, query: Uint8Array) => Response | Promise<Response>, seen: Seen[] = []): typeof fetch {
  return async (input, init) => {
    const query = new Uint8Array(init?.body as Uint8Array);
    seen.push({ url: String(input), method: init?.method ?? "GET", contentType: new Headers(init?.headers).get("Content-Type"), query });
    return answer(nameOf(query), query);
  };
}

const names = ["phish.example.testkeyplaceholder.dbl.dq.spamhaus.net", "phish.example.testkeyplaceholder.zrd.dq.spamhaus.net"];

describe("DNS over HTTPS for Spamhaus", () => {
  it("posts each question as a DNS message to Cloudflare's resolver, never putting the name in the address", async () => {
    const seen: Seen[] = [];
    const transport = dohTransport(
      resolver(
        (name, query) =>
          new Response(name.includes(".dbl.") ? replyFor(query, { addresses: ["127.0.1.4"] }) : replyFor(query, { rcode: 3 }), {
            headers: { "Content-Type": "application/dns-message" },
          }),
        seen,
      ),
    );
    expect(await transport.resolve(names)).toEqual([
      { status: "answered", rcode: 0, addresses: ["127.0.1.4"] },
      { status: "answered", rcode: 3, addresses: [] },
    ]);
    expect(seen.map((request) => [request.url, request.method, request.contentType])).toEqual([
      ["https://cloudflare-dns.com/dns-query", "POST", "application/dns-message"],
      ["https://cloudflare-dns.com/dns-query", "POST", "application/dns-message"],
    ]);
    expect(seen.map((request) => nameOf(request.query))).toEqual(names);
    for (const request of seen) {
      expect(request.url).not.toContain("testkey");
      expect([request.query[0], request.query[1]]).toEqual([0, 0]);
      expect(request.query[2]! & 0x01).toBe(1);
      expect(decodeDnsReply(request.query)).toBeNull();
    }
  });

  it("reports HTTP errors, garbled or cut-short answers, network failures, and timeouts as failures", async () => {
    const statuses = dohTransport(resolver(() => new Response("busy", { status: 503 })));
    expect(await statuses.resolve(names.slice(0, 1))).toEqual([{ status: "failed", reason: "http_error", detail: "HTTP 503" }]);
    const garbled = dohTransport(resolver(() => new Response(Uint8Array.from([1, 2, 3]))));
    expect(await garbled.resolve(names.slice(0, 1))).toEqual([{ status: "failed", reason: "malformed" }]);
    const truncated = dohTransport(resolver((_, query) => new Response(replyFor(query, { truncated: true }))));
    expect(await truncated.resolve(names.slice(0, 1))).toEqual([{ status: "failed", reason: "malformed" }]);
    const oversized = dohTransport(resolver(() => new Response(new Uint8Array(5000))));
    expect(await oversized.resolve(names.slice(0, 1))).toEqual([{ status: "failed", reason: "request_failed" }]);
    const offline = dohTransport(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await offline.resolve(names.slice(0, 1))).toEqual([{ status: "failed", reason: "request_failed" }]);
    const hanging = dohTransport(
      (_, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation timed out", "TimeoutError")));
        }),
    );
    expect(await hanging.resolve(names.slice(0, 1))).toEqual([{ status: "failed", reason: "reply_timeout" }]);
  }, 10_000);

  it("refuses names that are not valid DNS names and asks about at most 16 at once", async () => {
    const seen: Seen[] = [];
    const transport = dohTransport(resolver((_, query) => new Response(replyFor(query, { rcode: 3 })), seen));
    expect(await transport.resolve(["bad name.example"])).toEqual([{ status: "failed", reason: "request_failed" }]);
    expect(seen).toHaveLength(0);
    const many = Array.from({ length: 20 }, (_, index) => `site${index}.example.testkeyplaceholder.dbl.dq.spamhaus.net`);
    expect(await transport.resolve(many)).toHaveLength(16);
  });
});
