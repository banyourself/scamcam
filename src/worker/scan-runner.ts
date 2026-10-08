import { reviewMessage, type TextModel } from "../engine/ai-review";
import type { BreachIndex } from "../engine/breach-catalog";
import type { Lookups } from "../engine/cache";
import { fileReport } from "../engine/file-scan";
import { lookupFileHashes } from "../engine/hash-lookups";
import { lookupMod, lookupPackFiles } from "../engine/modrinth";
import { scanContent, type BudgetedProvider } from "../engine/scan";
import type { DnsTransport } from "../engine/spamhaus";
import type { EmailFacts } from "../shared/email";
import type { FileCheckRequest } from "../shared/file-check";
import type { ScanReport } from "../shared/report";
import { ScanReportSchema } from "../shared/report-schema";
import type { AppBindings } from "./env";
import { logEvent } from "./logging";
import { writesArePaused } from "./repositories/app-state";
import { d1DomainLists } from "./repositories/domain-lists";
import { dailyLimit, recordProviderCall } from "./repositories/provider-usage";
import { signReport } from "./security/report-signature";

export interface ScanDependencies {
  fetcher: typeof fetch;
  lookups: Lookups;
  aiModel: TextModel | null;
  extendedLookups?: boolean;
  dnsTransport?: DnsTransport;
  breaches?: BreachIndex | undefined;
}

export interface ScanOutcome {
  report: ScanReport;
  signature: string | null;
}

export function budgetTaker(env: AppBindings) {
  let paused: Promise<boolean> | null = null;
  const waiting = new Map<BudgetedProvider, ((allowed: boolean) => void)[]>();
  const flush = async (provider: BudgetedProvider) => {
    const batch = waiting.get(provider) ?? [];
    waiting.delete(provider);
    const limit = dailyLimit(env, provider);
    const calls = await recordProviderCall(env.DB, provider, new Date(), batch.length).catch(() => Number.POSITIVE_INFINITY);
    const before = calls - batch.length;
    batch.forEach((resolve, index) => resolve(limit !== null && before + index + 1 <= limit));
  };
  return async (provider: BudgetedProvider): Promise<boolean> => {
    paused ??= writesArePaused(env.DB).catch(() => true);
    if (await paused) {
      return provider !== "workers_ai" && provider !== "phishstats";
    }
    return new Promise<boolean>((resolve) => {
      const batch = waiting.get(provider);
      if (batch) {
        batch.push(resolve);
        return;
      }
      waiting.set(provider, [resolve]);
      setTimeout(() => void flush(provider), 0);
    });
  };
}

function aiModelFor(env: AppBindings, injected: TextModel | null): TextModel | null {
  if (env.AI_MODE !== "inconclusive") {
    return null;
  }
  if (injected) {
    return injected;
  }
  if (!env.AI) {
    return null;
  }
  const binding = env.AI as unknown as TextModel;
  return { run: (model, input) => binding.run(model, input) };
}

export async function runScan(env: AppBindings, content: string, dependencies: ScanDependencies, fromScreenshot = false, email?: EmailFacts): Promise<ScanOutcome> {
  const takeBudget = budgetTaker(env);
  const model = aiModelFor(env, dependencies.aiModel);
  const report = await scanContent(content, {
    fetcher: dependencies.fetcher,
    safeBrowsingKey: env.SAFE_BROWSING_API_KEY,
    urlhausKey: env.URLHAUS_AUTH_KEY,
    takeBudget,
    aiReview: model
      ? async (text) => {
          const started = Date.now();
          const result = await reviewMessage(text, { model, modelId: env.AI_MODEL, takeBudget: () => takeBudget("workers_ai") });
          logEvent("ai_review", {
            model: env.AI_MODEL,
            status: result.status,
            ...(result.status === "ok"
              ? { label: result.label, promptTokens: result.promptTokens, completionTokens: result.completionTokens, neurons: result.neurons }
              : {}),
            ms: Date.now() - started,
          });
          return result;
        }
      : undefined,
    lookups: dependencies.lookups,
    scamLists: d1DomainLists(env.DB, dependencies.lookups),
    fromScreenshot,
    email,
    extendedLookups: dependencies.extendedLookups ?? false,
    spamhaus: env.SPAMHAUS_DQS_KEY && dependencies.dnsTransport ? { key: env.SPAMHAUS_DQS_KEY, transport: dependencies.dnsTransport } : undefined,
    phishstatsKey: env.PHISHSTATS_API_KEY || undefined,
    radarToken: env.CLOUDFLARE_RADAR_TOKEN || undefined,
    steamKey: env.STEAM_WEB_API_KEY || undefined,
    discordToken: env.DISCORD_BOT_TOKEN || undefined,
    bitlyToken: env.BITLY_TOKEN || undefined,
    breaches: dependencies.breaches,
  });
  const checked = ScanReportSchema.parse(report);
  return { report: checked, signature: await signReport(checked, env.SHARE_SIGNING_KEY) };
}

export async function runFileCheck(env: AppBindings, request: FileCheckRequest, dependencies: ScanDependencies): Promise<ScanOutcome> {
  const takeBudget = budgetTaker(env);
  const sources = { fetcher: dependencies.fetcher, lookups: dependencies.lookups };
  const [checks, mod, pack] = await Promise.all([
    request.sha256
      ? lookupFileHashes({ sha256: request.sha256, sha1: request.sha1 }, { ...sources, abuseChKey: env.URLHAUS_AUTH_KEY, takeAbuseChBudget: () => takeBudget("urlhaus") })
      : [],
    request.kind === "java_archive" && request.sha1 && request.findings.includes("minecraft_mod") ? lookupMod({ sha1: request.sha1, modId: request.modId }, sources) : null,
    request.kind === "minecraft_modpack" && request.packJars && request.packJars.length > 0 ? lookupPackFiles(request.packJars, sources) : null,
  ]);
  const checked = ScanReportSchema.parse(fileReport(request, checks, new Date(), { mod, pack }));
  return { report: checked, signature: await signReport(checked, env.SHARE_SIGNING_KEY) };
}
