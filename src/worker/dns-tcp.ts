import { connect } from "cloudflare:sockets";
import { decodeDnsReply, encodeDnsQuery } from "../engine/dns-wire";
import { deadline } from "../engine/deadline";
import type { DnsAnswer, DnsTransport } from "../engine/spamhaus";

const maxReplyBytes = 4096;
const maxNamesPerConnection = 16;
const defaultTimeoutMs = 2500;

export interface SocketLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export type Connector = (address: { hostname: string; port: number }) => SocketLike;

export interface TcpDnsOptions {
  timeoutMs?: number;
  connector?: Connector;
  pickServer?: (servers: string[]) => string;
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

function randomServer(servers: string[]): string {
  return servers[crypto.getRandomValues(new Uint32Array(1))[0]! % servers.length]!;
}

export function tcpDnsTransport(servers: string[], options: TcpDnsOptions = {}): DnsTransport {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const connector = options.connector ?? ((address) => connect(address));
  const pickServer = options.pickServer ?? randomServer;
  return {
    async resolve(names: string[]): Promise<DnsAnswer[]> {
      const asked = names.slice(0, maxNamesPerConnection);
      const answers: DnsAnswer[] = asked.map(() => ({ status: "failed" }));
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
      const timedOut = new Promise<never>((_, reject) => {
        timer.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
      });
      timedOut.catch(() => undefined);
      let socket: SocketLike | null = null;
      try {
        socket = connector({ hostname: pickServer(servers), port: 53 });
        const writer = socket.writable.getWriter();
        await Promise.race([writer.write(framed), timedOut]);
        writer.releaseLock();
        const reader = socket.readable.getReader();
        let buffer: Uint8Array = new Uint8Array(0);
        while (pending.size > 0) {
          const { value, done } = await Promise.race([reader.read(), timedOut]);
          if (done || !value) {
            break;
          }
          buffer = join([buffer, value]);
          let malformed = false;
          while (buffer.length >= 2) {
            const length = (buffer[0]! << 8) | buffer[1]!;
            if (length === 0 || length > maxReplyBytes) {
              malformed = true;
              break;
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
          if (malformed || buffer.length > maxReplyBytes + 2) {
            break;
          }
        }
      } catch {
        return answers;
      } finally {
        timer.clear();
        socket?.close().catch(() => undefined);
      }
      return answers;
    },
  };
}
