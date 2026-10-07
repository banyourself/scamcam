import { DurableObject } from "cloudflare:workers";
import { createLookupState, memoryLookupCache } from "../engine/cache";
import { spamhausServers, type DnsAnswer, type DnsTransport } from "../engine/spamhaus";
import type { AppBindings } from "./env";
import type { FileCheckRequest } from "../shared/file-check";
import { tcpDnsTransport } from "./dns-tcp";
import { logEvent } from "./logging";
import { runFileCheck, runScan, type ScanDependencies, type ScanOutcome } from "./scan-runner";

export const scannerName = "scanner";
export const scannerLocation = "wnam";
const cachedLookups = 5000;
const alertEveryMs = 10 * 60 * 1000;

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
        logEvent("alert", { task: "scan", alert: "spamhaus_unavailable", reason, answered, asked: answers.length, ms: clock() - started });
      }
      return answers;
    },
  };
}

export class Scanner extends DurableObject<AppBindings> {
  private readonly lookupState = createLookupState();
  private readonly lookupCache = memoryLookupCache(Date.now, cachedLookups);
  private readonly dnsTransport = watchedTransport(tcpDnsTransport(spamhausServers));

  private dependencies(): ScanDependencies {
    return {
      fetcher: (input, init) => fetch(input, init),
      lookups: { cache: this.lookupCache, state: this.lookupState, clock: Date.now },
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
