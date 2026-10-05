import { extractInput } from "../shared/extract";
import type { Evidence, ScanReport, UncheckedSource } from "../shared/report";
import { freeHostingSuffixes, urlShorteners } from "./brands";
import { isPrivateAddress, lookupDns, type DnsResult } from "./dns";
import { analyzeMessage } from "./message-rules";
import { lookupRdap, type RdapResult } from "./rdap";
import { searchSafeBrowsing, threatDescriptions, type SafeBrowsingResult } from "./safe-browsing";
import { sourceNames, strengthPoints, type Signal } from "./signals";
import { analyzeLink, type AnalyzedLink } from "./url-analysis";
import { lookupUrlhausHost, sameUrl, type UrlhausResult } from "./urlhaus";
import { decideVerdict } from "./verdict";

export type BudgetedProvider = "safe_browsing" | "urlhaus";

export interface ScanOptions {
  fetcher: typeof fetch;
  safeBrowsingKey?: string | undefined;
  urlhausKey?: string | undefined;
  takeBudget: (provider: BudgetedProvider) => Promise<boolean>;
  now?: Date;
}

const maxNetworkLinks = 3;
const maxEvidence = 14;
const day = 24 * 60 * 60 * 1000;

function caseNumber(now: Date): string {
  const date = now.toISOString().slice(2, 10).replaceAll("-", "");
  const random = [...crypto.getRandomValues(new Uint8Array(2))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `SC-${date}-${random.toUpperCase()}`;
}

function linkScore(link: AnalyzedLink): number {
  return link.signals.filter((signal) => signal.direction === "raises").reduce((total, signal) => total + strengthPoints[signal.strength], 0);
}

function pickNetworkLinks(links: AnalyzedLink[]): AnalyzedLink[] {
  const seen = new Set<string>();
  return [...links]
    .filter((link) => link.hostname && !link.officialBrand)
    .sort((a, b) => linkScore(b) - linkScore(a))
    .filter((link) => {
      const key = link.registrableDomain ?? link.hostname!;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, maxNetworkLinks);
}

function isSharedHost(link: AnalyzedLink): boolean {
  const host = link.hostname ?? "";
  return Boolean(link.officialBrand) || urlShorteners.has(link.registrableDomain ?? "") || freeHostingSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function rdapSignals(link: AnalyzedLink, result: RdapResult, now: Date): Signal[] {
  const domain = link.registrableDomain!;
  const base = { source: sourceNames.rdap, link: link.hostname! };
  if (result.status === "not_found") {
    return [{ ...base, id: `rdap-missing-${domain}`, direction: "context", strength: "moderate", title: `${domain} is not registered`, detail: "The domain registry has no record of it. It may have been taken down or never existed." }];
  }
  if (result.status !== "ok") {
    return [];
  }
  const signals: Signal[] = [];
  if (result.registeredAt) {
    const ageDays = Math.floor((now.getTime() - Date.parse(result.registeredAt)) / day);
    if (Number.isFinite(ageDays) && ageDays >= 0) {
      if (ageDays < 30) {
        signals.push({
          ...base,
          id: `rdap-new-${domain}`,
          direction: "raises",
          strength: ageDays < 7 ? "moderate" : "weak",
          title: `${domain} was registered ${ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`}`,
          detail: "Most scam sites are brand new because they get reported and taken down quickly.",
        });
      } else if (ageDays >= 730) {
        signals.push({
          ...base,
          id: `rdap-old-${domain}`,
          direction: "context",
          strength: "weak",
          title: `${domain} has existed for ${Math.floor(ageDays / 365)} years`,
          detail: "Older domains are less likely to be throwaway scam sites, though old sites can still be hacked or sold.",
        });
      }
    }
  }
  if (result.statuses.some((status) => /hold/i.test(status))) {
    signals.push({
      ...base,
      id: `rdap-hold-${domain}`,
      direction: "raises",
      strength: "weak",
      title: `${domain} is on hold at its registry`,
      detail: "Domains are often put on hold after abuse reports or unpaid renewals.",
    });
  }
  return signals;
}

function dnsSignals(link: AnalyzedLink, result: DnsResult): Signal[] {
  const host = link.hostname!;
  const base = { source: sourceNames.dns, link: host };
  if (result.status !== "ok") {
    return [];
  }
  if (!result.exists) {
    return [{ ...base, id: `dns-missing-${host}`, direction: "context", strength: "moderate", title: `${link.displayHostname} does not exist right now`, detail: "The address does not lead anywhere at the moment. Scam sites are often taken down, then move to a new address." }];
  }
  if (result.addresses.some(isPrivateAddress)) {
    return [{ ...base, id: `dns-private-${host}`, direction: "raises", strength: "weak", title: "Points to a private network address", detail: "Public websites do not use private network addresses. This is unusual and can be used in attacks." }];
  }
  return [];
}

function urlhausSignals(link: AnalyzedLink, result: UrlhausResult): Signal[] {
  if (result.status !== "ok" || !result.listed) {
    return [];
  }
  const host = link.hostname!;
  const base = { source: sourceNames.urlhaus, link: host, ...(result.reference ? { sourceUrl: result.reference } : {}) };
  const exact = result.onlineUrls.some((url) => sameUrl(url, link.href ?? link.original) || sameUrl(url, link.original));
  if (exact) {
    return [{ ...base, id: `urlhaus-exact-${host}`, direction: "raises", strength: "critical", confirms: true, title: "URLhaus lists this exact link as spreading malware", detail: "abuse.ch's URLhaus project tracks links that deliver malware. This one is currently marked online." }];
  }
  if (isSharedHost(link)) {
    return [{ ...base, id: `urlhaus-shared-${host}`, direction: "context", strength: "weak", title: "Other links on this service have spread malware", detail: `URLhaus has ${result.total} malware reports for files on ${link.displayHostname}. Anyone can upload there, so check what this link actually is.` }];
  }
  if (result.onlineUrls.length > 0) {
    return [{ ...base, id: `urlhaus-online-${host}`, direction: "raises", strength: "critical", confirms: true, title: `URLhaus lists ${link.displayHostname} as serving malware right now`, detail: `abuse.ch's URLhaus project has ${result.total} malware reports for this site, and ${result.onlineUrls.length} are still online.` }];
  }
  return [{ ...base, id: `urlhaus-past-${host}`, direction: "raises", strength: "moderate", title: `${link.displayHostname} has spread malware before`, detail: `URLhaus has ${result.total} past malware reports for this site. None are online now.` }];
}

function toEvidence(signal: Signal, checkedAt: string): Evidence {
  return {
    id: signal.id,
    signal: signal.direction === "raises" ? "raises_risk" : signal.direction === "lowers" ? "lowers_risk" : "neutral",
    title: signal.title,
    detail: signal.detail,
    source: { name: signal.source, ...(signal.sourceUrl ? { url: signal.sourceUrl } : {}) },
    checkedAt,
  };
}

function order(signal: Signal): number {
  if (signal.direction === "raises") {
    return -strengthPoints[signal.strength];
  }
  return signal.direction === "context" ? 10 : 20;
}

export async function scanContent(content: string, options: ScanOptions): Promise<ScanReport> {
  const now = options.now ?? new Date();
  const checkedAt = now.toISOString();
  const extracted = extractInput(content);
  const links = extracted.links.map(analyzeLink);
  const readable = links.filter((link) => link.hostname);
  let messageText = extracted.redactedText;
  for (const link of extracted.links) {
    messageText = messageText.split(link).join(" [link] ");
  }
  const message = analyzeMessage(messageText);
  const urlOnly = extracted.links.length === 1 && messageText.replaceAll("[link]", "").trim() === "";
  const networkLinks = pickNetworkLinks(readable);
  const notChecked: UncheckedSource[] = [];
  const extraSignals = new Map<AnalyzedLink, Signal[]>();
  const attach = (link: AnalyzedLink, signals: Signal[]) => extraSignals.set(link, [...(extraSignals.get(link) ?? []), ...signals]);
  const generalSignals: Signal[] = [];

  let safeBrowsing: SafeBrowsingResult | null = null;
  const tasks: Promise<void>[] = [];
  if (readable.length > 0) {
    if (!options.safeBrowsingKey) {
      notChecked.push({ name: sourceNames.safeBrowsing, reason: "not_configured" });
    } else if (!(await options.takeBudget("safe_browsing"))) {
      notChecked.push({ name: sourceNames.safeBrowsing, reason: "over_budget" });
    } else {
      const key = options.safeBrowsingKey;
      tasks.push(
        searchSafeBrowsing(readable.map((link) => link.original), key, options.fetcher).then((result) => {
          safeBrowsing = result;
        }),
      );
    }
  }
  if (networkLinks.length > 0) {
    if (!options.urlhausKey) {
      notChecked.push({ name: sourceNames.urlhaus, reason: "not_configured" });
    } else {
      const key = options.urlhausKey;
      tasks.push(
        (async () => {
          let reason: UncheckedSource["reason"] | null = null;
          for (const link of networkLinks) {
            if (!(await options.takeBudget("urlhaus"))) {
              reason = "over_budget";
              continue;
            }
            const result = await lookupUrlhausHost(link.hostname!, key, options.fetcher);
            if (result.status === "unavailable") {
              reason ??= "unavailable";
            }
            attach(link, urlhausSignals(link, result));
          }
          if (reason) {
            notChecked.push({ name: sourceNames.urlhaus, reason });
          }
        })(),
      );
    }
    tasks.push(
      (async () => {
        const results = await Promise.all(
          networkLinks.map(async (link) => {
            if (link.isIp || link.isPrivateSuffix || link.communitySite || !link.registrableDomain) {
              return true;
            }
            const result = await lookupRdap(link.registrableDomain, options.fetcher);
            attach(link, rdapSignals(link, result, now));
            return result.status !== "unavailable";
          }),
        );
        if (results.some((ok) => !ok)) {
          notChecked.push({ name: sourceNames.rdap, reason: "unavailable" });
        }
      })(),
    );
    tasks.push(
      (async () => {
        const results = await Promise.all(
          networkLinks.map(async (link) => {
            if (link.isIp || link.communitySite) {
              return true;
            }
            const result = await lookupDns(link.hostname!, options.fetcher);
            attach(link, dnsSignals(link, result));
            return result.status !== "unavailable";
          }),
        );
        if (results.some((ok) => !ok)) {
          notChecked.push({ name: sourceNames.dns, reason: "unavailable" });
        }
      })(),
    );
  }
  await Promise.all(tasks);

  const safeBrowsingResult = safeBrowsing as SafeBrowsingResult | null;
  if (safeBrowsingResult?.status === "unavailable") {
    notChecked.push({ name: sourceNames.safeBrowsing, reason: "unavailable" });
  } else if (safeBrowsingResult?.status === "ok") {
    for (const link of readable) {
      const threats = safeBrowsingResult.threats.get(link.original);
      if (threats) {
        const description = threatDescriptions[threats[0]!] ?? "a site that may be unsafe";
        attach(link, [
          {
            id: `gsb-${link.hostname}`,
            source: sourceNames.safeBrowsing,
            link: link.hostname!,
            direction: "raises",
            strength: "critical",
            fromSafeBrowsing: true,
            title: `Google Safe Browsing warns this is ${description}`,
            detail: "Google Safe Browsing lists this link as unsafe. Warnings can occasionally be wrong, but treat it as dangerous.",
          },
        ]);
      }
    }
    if (safeBrowsingResult.threats.size === 0) {
      generalSignals.push({
        id: "gsb-clear",
        source: sourceNames.safeBrowsing,
        direction: "context",
        strength: "weak",
        title: readable.length === 1 ? "No warning from Google Safe Browsing" : "No Google Safe Browsing warning for any of these links",
        detail: "Google Safe Browsing had no warning when it was checked. New scam sites may not be listed yet.",
      });
    }
  }

  const linkSignals = links.map((link) => [...link.signals, ...(extraSignals.get(link) ?? [])]);
  const nonOfficial = readable.filter((link) => !link.officialBrand);
  const verdict = decideVerdict({
    messageSignals: message.signals,
    linkSignals,
    families: message.families,
    linkCount: readable.length,
    allLinksOfficial: readable.length > 0 && nonOfficial.length === 0,
    safeBrowsingCleared: safeBrowsingResult?.status === "ok" && nonOfficial.every((link) => !safeBrowsingResult.threats.has(link.original)),
    officialBrandNames: [...new Set(readable.map((link) => link.officialBrand?.name).filter((name): name is string => Boolean(name)))],
  });
  if (verdict.contradiction) {
    generalSignals.push({
      id: "contradiction",
      source: sourceNames.domain,
      direction: "context",
      strength: "weak",
      title: "Sources disagree",
      detail: "Some evidence says this is an official site while other evidence raises a warning. Confidence is lowered.",
    });
  }

  const primary = [...readable].sort((a, b) => linkScore(b) - linkScore(a))[0];
  const signals = [...message.signals, ...linkSignals.flat(), ...generalSignals]
    .filter((signal, index, list) => list.findIndex((other) => other.id === signal.id) === index)
    .sort((a, b) => order(a) - order(b))
    .slice(0, maxEvidence);
  const display = urlOnly ? extracted.links[0]! : extracted.redactedText.length > 280 ? `${extracted.redactedText.slice(0, 279)}…` : extracted.redactedText;

  return {
    caseNumber: caseNumber(now),
    createdAt: checkedAt,
    subject: {
      kind: urlOnly ? "url" : "message",
      display,
      ...(primary?.registrableDomain ? { registrableDomain: primary.registrableDomain } : {}),
    },
    level: verdict.level,
    confidence: verdict.confidence,
    summary: verdict.summary,
    evidence: signals.map((signal) => toEvidence(signal, checkedAt)),
    notChecked: [...new Map(notChecked.map((entry) => [entry.name, entry])).values()],
    recommendations: verdict.recommendations,
    usesGoogleSafeBrowsing: safeBrowsingResult?.status === "ok",
  };
}
