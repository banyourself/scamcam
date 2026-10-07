import { afterEach, describe, expect, it, vi } from "vitest";
import { spamhausServers, type DnsAnswer, type DnsTransport } from "../../src/engine/spamhaus";
import { tcpDnsTransport, type Connector } from "../../src/worker/dns-tcp";
import { watchedTransport } from "../../src/worker/scanner";

interface Query {
  id: number;
  message: Uint8Array;
}

function replyTo(query: Query, options: { addresses?: string[]; rcode?: number; truncated?: boolean; id?: number } = {}): Uint8Array {
  const id = options.id ?? query.id;
  const question = query.message.subarray(12);
  const answers = (options.addresses ?? []).flatMap((address) => [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, ...address.split(".").map(Number)]);
  const flags = 0x8400 | (options.truncated ? 0x0200 : 0) | (options.rcode ?? 0);
  const body = [id >> 8, id & 0xff, flags >> 8, flags & 0xff, 0, 1, 0, (options.addresses ?? []).length, 0, 0, 0, 0, ...question, ...answers];
  return Uint8Array.from([body.length >> 8, body.length & 0xff, ...body]);
}

function fakeServer(handler: (queries: Query[]) => Uint8Array[]) {
  const opened: { hostname: string; port: number }[] = [];
  let closed = 0;
  const connector: Connector = (address) => {
    opened.push(address);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const readable = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const writable = new WritableStream<Uint8Array>({
      write(chunk) {
        const queries: Query[] = [];
        for (let offset = 0; offset + 2 <= chunk.length; ) {
          const length = (chunk[offset]! << 8) | chunk[offset + 1]!;
          const message = chunk.slice(offset + 2, offset + 2 + length);
          queries.push({ id: (message[0]! << 8) | message[1]!, message });
          offset += length + 2;
        }
        for (const part of handler(queries)) {
          controller.enqueue(part);
        }
      },
    });
    return {
      readable,
      writable,
      async close() {
        closed += 1;
        try {
          controller.close();
        } catch {
          return;
        }
      },
    };
  };
  return { connector, opened, closed: () => closed };
}

function pieces(bytes: Uint8Array[], size: number): Uint8Array[] {
  const joined = Uint8Array.from(bytes.flatMap((part) => [...part]));
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < joined.length; offset += size) {
    parts.push(joined.slice(offset, offset + size));
  }
  return parts;
}

const names = ["phish.example.testkey0123456789abcdefgh.dbl.dq.spamhaus.net", "phish.example.testkey0123456789abcdefgh.zrd.dq.spamhaus.net"];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DNS over TCP to Spamhaus", () => {
  it("sends every question on one connection to port 53 and matches answers by id, in any order and in pieces", async () => {
    const server = fakeServer((queries) => pieces([replyTo(queries[1]!, { rcode: 3 }), replyTo(queries[0]!, { addresses: ["127.0.1.4"] })], 3));
    const transport = tcpDnsTransport(spamhausServers, { connector: server.connector, pickServer: (servers) => servers[0]! });
    expect(await transport.resolve(names)).toEqual([
      { status: "answered", rcode: 0, addresses: ["127.0.1.4"] },
      { status: "answered", rcode: 3, addresses: [] },
    ]);
    expect(server.opened).toEqual([{ hostname: "a.gns.spamhaus.net", port: 53 }]);
    expect(server.closed()).toBe(1);
  });

  it("gives up after its time limit and closes the connection", async () => {
    const server = fakeServer(() => []);
    const transport = tcpDnsTransport(spamhausServers, { connector: server.connector, timeoutMs: 30 });
    expect(await transport.resolve(names)).toEqual([
      { status: "failed", reason: "reply_timeout" },
      { status: "failed", reason: "reply_timeout" },
    ]);
    expect(server.closed()).toBe(1);
  });

  it("says which step failed: opening the connection, waiting for it, or a reply cut off", async () => {
    const socketWith = (opened: Promise<unknown>, readable = new ReadableStream<Uint8Array>()) => ({
      readable,
      writable: new WritableStream<Uint8Array>(),
      opened,
      close: async () => undefined,
    });
    const refused = tcpDnsTransport(spamhausServers, { connector: () => socketWith(Promise.reject(new Error("connection refused"))) });
    expect((await refused.resolve(names)).map((answer) => answer.status === "failed" && answer.reason)).toEqual(["connect_failed", "connect_failed"]);
    const hanging = tcpDnsTransport(spamhausServers, { connector: () => socketWith(new Promise(() => undefined)), timeoutMs: 30 });
    expect((await hanging.resolve(names)).map((answer) => answer.status === "failed" && answer.reason)).toEqual(["connect_timeout", "connect_timeout"]);
    const ended = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const closed = tcpDnsTransport(spamhausServers, { connector: () => socketWith(Promise.resolve({}), ended), timeoutMs: 500 });
    expect((await closed.resolve(names)).map((answer) => answer.status === "failed" && answer.reason)).toEqual(["closed_early", "closed_early"]);
  });

  it("ignores answers with the wrong id or cut short, and stops at nonsense", async () => {
    const server = fakeServer((queries) => [
      replyTo(queries[0]!, { id: [...Array(65536).keys()].find((id) => queries.every((query) => query.id !== id))!, addresses: ["127.0.1.4"] }),
      replyTo(queries[1]!, { truncated: true }),
      Uint8Array.from([0xff, 0xff, 1, 2, 3]),
    ]);
    const transport = tcpDnsTransport(spamhausServers, { connector: server.connector, timeoutMs: 500 });
    expect(await transport.resolve(names)).toEqual([
      { status: "failed", reason: "malformed" },
      { status: "failed", reason: "malformed" },
    ]);
    expect(server.closed()).toBe(1);
  });

  it("answers nothing when the connection cannot be made", async () => {
    const transport = tcpDnsTransport(spamhausServers, {
      connector: () => {
        throw new Error("connection refused");
      },
    });
    expect(await transport.resolve(names)).toEqual([
      { status: "failed", reason: "connect_failed" },
      { status: "failed", reason: "connect_failed" },
    ]);
    expect(await transport.resolve([])).toEqual([]);
  });

  it("raises one alert every ten minutes at most, without the query names that hold the key", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let now = 0;
    const answers: DnsAnswer[] = [{ status: "answered", rcode: 2, addresses: [] }];
    const failing: DnsTransport = { resolve: async () => answers };
    const watched = watchedTransport(failing, () => now);
    await watched.resolve(names);
    await watched.resolve(names);
    now += 10 * 60 * 1000;
    answers[0] = { status: "answered", rcode: 0, addresses: ["127.255.255.255"] };
    await watched.resolve(names);
    now += 10 * 60 * 1000;
    answers[0] = { status: "failed", reason: "connect_timeout" };
    answers[1] = { status: "answered", rcode: 3, addresses: [] };
    await watched.resolve(names);
    const alerts = log.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>).filter((entry) => entry.event === "alert");
    expect(alerts.map((entry) => [entry.alert, entry.reason, entry.answered, entry.asked])).toEqual([
      ["spamhaus_unavailable", "rcode_2", 1, 1],
      ["spamhaus_unavailable", "code_255", 1, 1],
      ["spamhaus_unavailable", "connect_timeout", 1, 2],
    ]);
    expect(log.mock.calls.join(" ")).not.toContain("testkey");
  });
});
