import { connect } from "cloudflare:sockets";
import { decodeDnsReply, encodeDnsQuery } from "../engine/dns-wire";
import { deadline } from "../engine/deadline";
import type { DnsAnswer, DnsFailure, DnsTransport } from "../engine/spamhaus";

const maxReplyBytes = 4096;
const maxNamesPerConnection = 16;
const maxAttempts = 2;
const defaultTimeoutMs = 4000;

export interface SocketLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened?: Promise<unknown>;
  close(): Promise<void>;
}

export type Connector = (address: { hostname: string; port: number }) => SocketLike;

export interface TcpDnsOptions {
  timeoutMs?: number;
  connector?: Connector;
  pickOrder?: (servers: string[]) => string[];
  resolveAddress?: (hostname: string) => Promise<string | null>;
}

interface Exchange {
  failure: DnsFailure | null;
  detail?: string;
}

function join(parts: Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function uniqueIds(count: number): number[] {
  const ids = new Set<number>();
  while (ids.size < count) {
    for (const value of crypto.getRandomValues(new Uint16Array(count))) {
      if (ids.size < count) {
        ids.add(value);
      }
    }
  }
  return [...ids];
}

function shuffled(servers: string[]): string[] {
  const order = [...servers];
  const random = crypto.getRandomValues(new Uint32Array(order.length));
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = random[index]! % (index + 1);
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  return order;
}

export function describeError(error: unknown): string | undefined {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === "string" ? error : "";
  const cleaned = text
    .replace(/[A-Za-z0-9]{16,}/g, "[hidden]")
    .replace(/[^A-Za-z0-9 .,:()_[\]/-]/g, "")
    .trim()
    .slice(0, 160);
  return cleaned === "" ? undefined : cleaned;
}

async function exchange(
  connector: Connector,
  address: string,
  framed: Uint8Array,
  pending: Map<number, number>,
  answers: DnsAnswer[],
  timedOut: Promise<never>,
  timeoutError: Error,
): Promise<Exchange> {
  let failure: DnsFailure = "connect_failed";
  let socket: SocketLike | null = null;
  try {
    socket = connector({ hostname: address, port: 53 });
    if (socket.opened) {
      failure = "connect_timeout";
      const opened = socket.opened.catch((error: unknown) => {
        failure = "connect_failed";
        throw error;
      });
      await Promise.race([opened, timedOut]);
    }
    failure = "write_failed";
    const writer = socket.writable.getWriter();
    await Promise.race([writer.write(framed), timedOut]);
    writer.releaseLock();
    failure = "reply_timeout";
    const reader = socket.readable.getReader();
    let buffer: Uint8Array = new Uint8Array(0);
    while (pending.size > 0) {
      const { value, done } = await Promise.race([reader.read(), timedOut]);
      if (done || !value) {
        return { failure: "closed_early" };
      }
      buffer = join([buffer, value]);
      while (buffer.length >= 2) {
        const length = (buffer[0]! << 8) | buffer[1]!;
        if (length === 0 || length > maxReplyBytes) {
          return { failure: "malformed" };
        }
        if (buffer.length < length + 2) {
          break;
        }
        const reply = decodeDnsReply(buffer.subarray(2, length + 2));
        buffer = buffer.slice(length + 2);
        const index = reply ? pending.get(reply.id) : undefined;
        if (reply && index !== undefined && !reply.truncated) {
          answers[index] = { status: "answered", rcode: reply.rcode, addresses: reply.addresses };
          pending.delete(reply.id);
        }
      }
      if (buffer.length > maxReplyBytes + 2) {
        return { failure: "malformed" };
      }
    }
    return { failure: null };
  } catch (error) {
    const detail = error === timeoutError ? undefined : describeError(error);
    return detail ? { failure, detail } : { failure };
  } finally {
    socket?.close().catch(() => undefined);
  }
}

export function tcpDnsTransport(servers: string[], options: TcpDnsOptions = {}): DnsTransport {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const connector = options.connector ?? ((address) => connect(address));
  const pickOrder = options.pickOrder ?? shuffled;
  const resolveAddress = options.resolveAddress ?? (async () => null);
  return {
    async resolve(names: string[]): Promise<DnsAnswer[]> {
      const asked = names.slice(0, maxNamesPerConnection);
      const answers: DnsAnswer[] = asked.map(() => ({ status: "failed", reason: "connect_failed" }));
      if (asked.length === 0 || servers.length === 0) {
        return answers;
      }
      const ids = uniqueIds(asked.length);
      const pending = new Map(ids.map((id, index) => [id, index]));
      const framed = join(
        asked.map((name, index) => {
          const message = encodeDnsQuery(ids[index]!, name);
          return join([Uint8Array.of(message.length >> 8, message.length & 0xff), message]);
        }),
      );
      const timer = deadline(timeoutMs);
      const timeoutError = new Error("timeout");
      const timedOut = new Promise<never>((_, reject) => {
        timer.signal.addEventListener("abort", () => reject(timeoutError), { once: true });
      });
      timedOut.catch(() => undefined);
      let last: Exchange = { failure: "connect_failed" };
      let attempts = 0;
      try {
        for (const server of pickOrder(servers).slice(0, maxAttempts)) {
          attempts += 1;
          const address = (await Promise.race([resolveAddress(server).catch(() => null), timedOut]).catch(() => null)) ?? server;
          last = await exchange(connector, address, framed, pending, answers, timedOut, timeoutError);
          if (last.failure !== "connect_failed") {
            break;
          }
        }
      } finally {
        timer.clear();
      }
      return answers.map((answer) =>
        answer.status === "failed" ? { status: "failed", reason: last.failure ?? "reply_timeout", attempts, ...(last.detail ? { detail: last.detail } : {}) } : answer,
      );
    },
  };
}
