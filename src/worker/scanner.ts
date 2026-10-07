import { DurableObject } from "cloudflare:workers";
import { createLookupState, memoryLookupCache, type Lookups } from "../engine/cache";
import { lookupDns } from "../engine/dns";
import { spamhausServers, type DnsAnswer, type DnsTransport } from "../engine/spamhaus";
import type { AppBindings } from "./env";
import type { FileCheckRequest } from "../shared/file-check";
import { describeError, tcpDnsTransport } from "./dns-tcp";
import { logEvent } from "./logging";
import { runFileCheck, runScan, type ScanDependencies, type ScanOutcome } from "./scan-runner";

export const scannerName = "scanner";
export const scannerLocation = "wnam";
const cachedLookups = 5000;
const alertEveryMs = 10 * 60 * 1000;
const ipv4Pattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const watchedHosts = new Map([
  ["api.phishstats.info", "phishstats"],
  ["api.cloudflare.com", "radar"],
]);

function problemWith(answer: DnsAnswer): string | null {
  if (answer.status === "failed") {
    return answer.reason ?? "no_answer";
  }
  if (answer.rcode !== 0 && answer.rcode !== 3) {
    return `rcode_${answer.rcode}`;
  }
  const error = answer.addresses.find((address) => address.startsWith("127.255.255."));
  return error ? `code_${error.split(".")[3]}` : null;
}

export function watchedTransport(transport: DnsTransport, clock: () => number = Date.now): DnsTransport {
  let lastAlert = Number.NEGATIVE_INFINITY;
  return {
    async resolve(names) {
      const started = clock();
      const answers = await transport.resolve(names);
      const reason = answers.map(problemWith).find((problem) => problem !== null);
      if (reason && clock() - lastAlert >= alertEveryMs) {
        lastAlert = clock();
        const answered = answers.filter((answer) => answer.status === "answered").length;
        const failed = answers.find((answer) => answer.status === "failed");
        logEvent("alert", {
          task: "scan",
          alert: "spamhaus_unavailable",
          reason,
          answered,
          asked: answers.length,
          ms: clock() - started,
          ...(failed?.status === "failed" && failed.attempts ? { attempts: failed.attempts } : {}),
          ...(failed?.status === "failed" && failed.detail ? { detail: failed.detail } : {}),
        });
      }
      return answers;
    },
  };
}

async function errorText(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = JSON.parse((await response.text()).slice(0, 4096));
    const record = (body ?? {}) as { error?: unknown; message?: unknown; errors?: { message?: unknown }[] };
    const message = record.error ?? record.message ?? record.errors?.[0]?.message;
    return typeof message === "string" ? describeError(message) : undefined;
  } catch {
    return undefined;
  }
}

export function watchedFetcher(fetcher: typeof fetch, clock: () => number = Date.now): typeof fetch {
  const lastAlert = new Map<string, number>();
  const alert = (provider: string, fields: Record<string, unknown>) => {
    if (clock() - (lastAlert.get(provider) ?? Number.NEGATIVE_INFINITY) < alertEveryMs) {
      return;
    }
    lastAlert.set(provider, clock());
    logEvent("alert", { task: "scan", alert: `${provider}_unavailable`, ...fields });
  };
  return async (input, init) => {
    const provider = watchedHosts.get(new URL(input instanceof Request ? input.url : String(input)).hostname);
    if (!provider) {
      return fetcher(input, init);
    }
    try {
      const response = await fetcher(input, init);
      if (!response.ok && !(provider === "radar" && response.status === 404)) {
        const detail = await errorText(response.clone());
        alert(provider, { status: response.status, ...(detail ? { detail } : {}) });
      }
      return response;
    } catch (error) {
      alert(provider, { reason: error instanceof Error ? error.name : "unknown" });
      throw error;
    }
  };
}

export class Scanner extends DurableObject<AppBindings> {
  private readonly lookupState = createLookupState();
  private readonly lookupCache = memoryLookupCache(Date.now, cachedLookups);
  private readonly lookups: Lookups = { cache: this.lookupCache, state: this.lookupState, clock: Date.now };
  private readonly fetcher = watchedFetcher((input, init) => fetch(input, init));
  private readonly dnsTransport = watchedTransport(
    tcpDnsTransport(spamhausServers, {
      resolveAddress: async (hostname) => {
        const result = await lookupDns(hostname, this.fetcher, this.lookups);
        return result.status === "ok" ? (result.addresses.find((address) => ipv4Pattern.test(address)) ?? null) : null;
      },
    }),
  );

  private dependencies(): ScanDependencies {
    return {
      fetcher: this.fetcher,
      lookups: this.lookups,
      aiModel: null,
      extendedLookups: true,
      dnsTransport: this.dnsTransport,
    };
  }

  async scan(content: string, fromScreenshot = false): Promise<ScanOutcome> {
    return runScan(this.env, content, this.dependencies(), fromScreenshot);
  }

  async checkFile(request: FileCheckRequest): Promise<ScanOutcome> {
    return runFileCheck(this.env, request, this.dependencies());
  }
}

export async function scanInScanner(namespace: DurableObjectNamespace<Scanner>, content: string, fromScreenshot = false): Promise<ScanOutcome> {
  const stub = namespace.get(namespace.idFromName(scannerName), { locationHint: scannerLocation });
  return (await stub.scan(content, fromScreenshot)) as ScanOutcome;
}

export async function checkFileInScanner(namespace: DurableObjectNamespace<Scanner>, request: FileCheckRequest): Promise<ScanOutcome> {
  const stub = namespace.get(namespace.idFromName(scannerName), { locationHint: scannerLocation });
  return (await stub.checkFile(request)) as ScanOutcome;
}
