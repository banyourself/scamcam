import { deadline } from "./deadline";
import { dohEndpoint } from "./dns";
import { decodeDnsReply, encodeDnsQuery } from "./dns-wire";
import { readLimitedBytes } from "./limited-body";
import type { DnsAnswer, DnsTransport } from "./spamhaus";

const maxReplyBytes = 4096;
const maxNames = 16;
const timeoutMs = 4000;

async function ask(fetcher: typeof fetch, endpoint: string, name: string): Promise<DnsAnswer> {
  const timer = deadline(timeoutMs);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/dns-message", Accept: "application/dns-message" },
      body: encodeDnsQuery(0, name, true),
      signal: timer.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "failed", reason: "http_error", detail: `HTTP ${response.status}` };
    }
    const reply = decodeDnsReply(await readLimitedBytes(response, maxReplyBytes));
    if (!reply || reply.truncated) {
      return { status: "failed", reason: "malformed" };
    }
    return { status: "answered", rcode: reply.rcode, addresses: reply.addresses };
  } catch {
    return { status: "failed", reason: timer.signal.aborted ? "reply_timeout" : "request_failed" };
  } finally {
    timer.clear();
  }
}

export function dohTransport(fetcher: typeof fetch, endpoint: string = dohEndpoint): DnsTransport {
  return {
    async resolve(names: string[]): Promise<DnsAnswer[]> {
      return Promise.all(names.slice(0, maxNames).map((name) => ask(fetcher, endpoint, name)));
    },
  };
}
