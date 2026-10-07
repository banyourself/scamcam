import { DurableObject } from "cloudflare:workers";
import { createLookupState, memoryLookupCache, type Lookups } from "../engine/cache";
import { dohTransport } from "../engine/doh-transport";
import type { DnsAnswer, DnsTransport } from "../engine/spamhaus";
import type { AppBindings } from "./env";
import type { EmailFacts } from "../shared/email";
import type { FileCheckRequest } from "../shared/file-check";
import { logEvent } from "./logging";
import { runFileCheck, runScan, type ScanDependencies, type ScanOutcome } from "./scan-runner";

export const scannerName = "scanner";
export const scannerLocation = "wnam";
const cachedLookups = 5000;
const alertEveryMs = 10 * 60 * 1000;
const watchedHosts = new Map([
  ["api.phishstats.info", "phishstats"],
  ["api.cloudflare.com", "radar"],
  ["discord.com", "discord"],
  ["api.steampowered.com", "steam"],
  ["urlhaus-api.abuse.ch", "urlhaus"],
  ["threatfox-api.abuse.ch", "threatfox"],
  ["mb-api.abuse.ch", "malwarebazaar"],
  ["api-ssl.bitly.com", "bitly"],
  ["is.gd", "isgd"],
  ["v.gd", "isgd"],
  ["api.modrinth.com", "modrinth"],
]);
const missingIsAnswer = new Set(["radar", "discord", "modrinth"]);

export function describeError(error: unknown): string | undefined {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === "string" ? error : "";
  const cleaned = text
    .replace(/[A-Za-z0-9]{16,}/g, "[hidden]")
    .replace(/[^A-Za-z0-9 .,:()_[\]/-]/g, "")
    .trim()
    .slice(0, 160);
  return cleaned === "" ? undefined : cleaned;
}

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
        const detail = failed?.status === "failed" ? describeError(failed.detail ?? "") : undefined;
        logEvent("alert", { task: "scan", alert: "spamhaus_unavailable", reason, answered, asked: answers.length, ms: clock() - started, ...(detail ? { detail } : {}) });
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
      if (!response.ok && !(missingIsAnswer.has(provider) && response.status === 404)) {
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
  private readonly dnsTransport = watchedTransport(dohTransport(this.fetcher));

  private dependencies(): ScanDependencies {
    return {
      fetcher: this.fetcher,
      lookups: this.lookups,
      aiModel: null,
      extendedLookups: true,
      dnsTransport: this.dnsTransport,
    };
  }

  async scan(content: string, fromScreenshot = false, email?: EmailFacts): Promise<ScanOutcome> {
    return runScan(this.env, content, this.dependencies(), fromScreenshot, email);
  }

  async checkFile(request: FileCheckRequest): Promise<ScanOutcome> {
    return runFileCheck(this.env, request, this.dependencies());
  }
}

export async function scanInScanner(namespace: DurableObjectNamespace<Scanner>, content: string, fromScreenshot = false, email?: EmailFacts): Promise<ScanOutcome> {
  const stub = namespace.get(namespace.idFromName(scannerName), { locationHint: scannerLocation });
  return (await stub.scan(content, fromScreenshot, email)) as ScanOutcome;
}

export async function checkFileInScanner(namespace: DurableObjectNamespace<Scanner>, request: FileCheckRequest): Promise<ScanOutcome> {
  const stub = namespace.get(namespace.idFromName(scannerName), { locationHint: scannerLocation });
  return (await stub.checkFile(request)) as ScanOutcome;
}
