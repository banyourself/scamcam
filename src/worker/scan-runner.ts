import { reviewMessage, type TextModel } from "../engine/ai-review";
import type { Lookups } from "../engine/cache";
import { scanContent, type BudgetedProvider } from "../engine/scan";
import type { ScanReport } from "../shared/report";
import { ScanReportSchema } from "../shared/report-schema";
import type { AppBindings } from "./env";
import { logEvent } from "./logging";
import { writesArePaused } from "./repositories/app-state";
import { d1DomainList } from "./repositories/domain-lists";
import { dailyLimit, recordProviderCall } from "./repositories/provider-usage";
import { signReport } from "./security/report-signature";

export interface ScanDependencies {
  fetcher: typeof fetch;
  lookups: Lookups;
  aiModel: TextModel | null;
}

export interface ScanOutcome {
  report: ScanReport;
  signature: string | null;
}

function budgetTaker(env: AppBindings) {
  let paused: boolean | null = null;
  return async (provider: BudgetedProvider): Promise<boolean> => {
    paused ??= await writesArePaused(env.DB).catch(() => true);
    if (paused) {
      return provider !== "workers_ai";
    }
    const limit = dailyLimit(env, provider);
    const calls = await recordProviderCall(env.DB, provider).catch(() => Number.POSITIVE_INFINITY);
    return limit !== null && calls <= limit;
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

export async function runScan(env: AppBindings, content: string, dependencies: ScanDependencies): Promise<ScanOutcome> {
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
    phishingList: d1DomainList(env.DB, "phishing_database", dependencies.lookups),
  });
  const checked = ScanReportSchema.parse(report);
  return { report: checked, signature: await signReport(checked, env.SHARE_SIGNING_KEY) };
}
