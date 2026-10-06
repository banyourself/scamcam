import { DurableObject } from "cloudflare:workers";
import { createLookupState, memoryLookupCache } from "../engine/cache";
import type { AppBindings } from "./env";
import { runScan, type ScanOutcome } from "./scan-runner";

export const scannerName = "scanner";
export const scannerLocation = "wnam";
const cachedLookups = 5000;

export class Scanner extends DurableObject<AppBindings> {
  private readonly lookupState = createLookupState();
  private readonly lookupCache = memoryLookupCache(Date.now, cachedLookups);

  async scan(content: string, fromScreenshot = false): Promise<ScanOutcome> {
    return runScan(this.env, content, {
      fetcher: (input, init) => fetch(input, init),
      lookups: { cache: this.lookupCache, state: this.lookupState, clock: Date.now },
      aiModel: null,
    }, fromScreenshot);
  }
}

export async function scanInScanner(namespace: DurableObjectNamespace<Scanner>, content: string, fromScreenshot = false): Promise<ScanOutcome> {
  const stub = namespace.get(namespace.idFromName(scannerName), { locationHint: scannerLocation });
  return (await stub.scan(content, fromScreenshot)) as ScanOutcome;
}
