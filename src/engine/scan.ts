import type { BreachEntry } from "../shared/api";
import { hibpBreachUrl } from "../shared/breaches";
import type { EmailFacts } from "../shared/email";
import { extractInput, maskedLinks, qrValues, withoutQrLabels } from "../shared/extract";
import type { Evidence, ScanReport, UncheckedSource } from "../shared/report";
import { brands, brandsNamedIn, freeHostOf, officialBrandFor, urlShorteners, userContentHosts } from "./brands";
import type { AiReviewResult } from "./ai-review";
import type { BreachIndex } from "./breach-catalog";
import { cacheKey, memoryLookups, recallFromMemory, recordOutcome, rememberInMemory, sourceIsOpen, type Lookups } from "./cache";
import { discordInviteDocs, lookupDiscordInvite, type DiscordInviteResult } from "./discord-invite";
import { isPrivateAddress, lookupHost, type HostResult } from "./dns";
import { candidateNames, domainListDetails, isDomainList, type DomainListLookup, type DomainListName, type DomainListResult } from "./domain-list";
import { caseNumber } from "./case-number";
import { emailSignals, senderLink, senderNameIn } from "./email-signals";
import { aimsAtCheckers } from "./injection";
import { analyzeMessage, familyNames, normalizeMessage } from "./message-rules";
import { lookupPhishstats, phishstatsHomePage, type PhishstatsResult } from "./phishstats";
import { isPopular, lookupRadar, radarHomePage, type RadarResult } from "./radar";
import { lookupRdap, type RdapResult } from "./rdap";
import { isRedirectorHost, maxUnwrapDepth, unwrapRedirect } from "./redirects";
import { searchSafeBrowsing, threatDefinitionUrls, threatDescriptions, type SafeBrowsingResult } from "./safe-browsing";
import { sourceNames, strengthPoints, type ScamFamily, type Signal } from "./signals";
import { lookupSpamhaus, spamhausDblUrl, spamhausZrdUrl, type DblListing, type DnsTransport, type SpamhausResult } from "./spamhaus";
import { bitlyHomePage, expandShortLink, isgdHomePage, maxExpandedLinks, shortLinkRef, type ShortLinkRef, type ShortLinkService } from "./short-links";
import { lookupSteamAccounts, maxSteamAccounts, steamHomePage, type SteamAccountResult } from "./steam";
import { analyzeLink, type AnalyzedLink } from "./url-analysis";
import { lookupThreatfoxHost, threatfoxHomePage, type ThreatfoxResult } from "./threatfox";
import { lookupUrlhausHost, sameUrl, urlhausHomePage, type UrlhausResult } from "./urlhaus";
import { decideVerdict } from "./verdict";

export type BudgetedProvider = "safe_browsing" | "urlhaus" | "workers_ai" | "phishstats";

export interface ScanOptions {
  fetcher: typeof fetch;
  safeBrowsingKey?: string | undefined;
  urlhausKey?: string | undefined;
  takeBudget: (provider: BudgetedProvider) => Promise<boolean>;
  lookups?: Lookups;
  scamLists?: DomainListLookup;
  aiReview?: (text: string) => Promise<AiReviewResult>;
  now?: Date;
  fromScreenshot?: boolean;
  extendedLookups?: boolean;
  spamhaus?: { key: string; transport: DnsTransport } | undefined;
  phishstatsKey?: string | undefined;
  radarToken?: string | undefined;
  steamKey?: string | undefined;
  discordToken?: string | undefined;
  bitlyToken?: string | undefined;
  email?: EmailFacts | undefined;
  breaches?: BreachIndex | undefined;
}

const maxNetworkLinks = 3;
const maxRadarLinks = 2;
const maxDiscordInvites = 2;
const maxBreachDomains = 2;
const newAccountDays = 30;
const recentReportDays = 90;
const maxUnwrappedLinks = 5;
const cloudflareFilterUrl = "https://developers.cloudflare.com/1.1.1.1/setup/#1111-for-families";
const maxListedLinks = 10;
const minReviewCharacters = 20;
const aiMemorySeconds = 60 * 60;
const aiSource = "workers_ai";
const maxEvidence = 14;
const day = 24 * 60 * 60 * 1000;
const freshHoldDays = 90;

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
  return Boolean(link.officialBrand) || urlShorteners.has(link.registrableDomain ?? "") || freeHostOf(host) !== null;
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
  const parsedAge = result.registeredAt ? Math.floor((now.getTime() - Date.parse(result.registeredAt)) / day) : Number.NaN;
  const ageDays = Number.isFinite(parsedAge) && parsedAge >= 0 ? parsedAge : null;
  if (result.registeredAt) {
    if (ageDays !== null) {
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
    const fresh = ageDays !== null && ageDays < freshHoldDays;
    signals.push({
      ...base,
      id: `rdap-hold-${domain}`,
      direction: "raises",
      strength: fresh ? "moderate" : "weak",
      title: fresh ? `${domain} was suspended soon after it was registered` : `${domain} is on hold at its registry`,
      detail: fresh
        ? "Its registry or registrar put this new domain on hold, which usually follows abuse reports or an owner who could not be verified. It is offline now, but scam pages often come back at a new address."
        : "Domains are often put on hold after abuse reports or unpaid renewals.",
    });
  }
  return signals;
}

function dnsSignals(link: AnalyzedLink, result: HostResult): Signal[] {
  const host = link.hostname!;
  const base = { source: sourceNames.dns, link: host };
  if (result.status !== "ok" || result.blocked) {
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

function filterSignals(link: AnalyzedLink, result: HostResult): Signal[] {
  if (result.status !== "ok" || !result.blocked) {
    return [];
  }
  return [
    {
      id: `dns-filter-${link.hostname}`,
      source: sourceNames.dnsFilter,
      sourceUrl: cloudflareFilterUrl,
      link: link.hostname!,
      direction: "raises",
      strength: "critical",
      title: "Cloudflare's security filter blocks this site",
      detail: "Cloudflare's 1.1.1.2 service, which blocks known malware and phishing sites, refuses to look up this address. Its list can occasionally be wrong, but do not open the link or enter any details.",
    },
  ];
}

function withDestinations(originals: string[], wrappers: Set<AnalyzedLink>): AnalyzedLink[] {
  const links: AnalyzedLink[] = [];
  let unwrapped = 0;
  for (const original of originals) {
    let current = analyzeLink(original);
    links.push(current);
    for (let depth = 0; depth < maxUnwrapDepth && current.href && unwrapped < maxUnwrappedLinks; depth += 1) {
      const redirect = unwrapRedirect(current.href);
      if (!redirect) {
        break;
      }
      const destination = analyzeLink(redirect.target);
      if (!destination.hostname || links.some((link) => link.href === destination.href)) {
        break;
      }
      unwrapped += 1;
      const wrapper = current;
      wrappers.add(wrapper);
      wrapper.signals = [
        ...wrapper.signals.filter((signal) => signal.direction !== "lowers"),
        {
          id: `redirect-${wrapper.hostname}-${destination.hostname}`,
          source: sourceNames.domain,
          link: wrapper.hostname!,
          direction: "context",
          strength: "weak",
          title: `${redirect.via} sends you on to ${destination.displayHostname}`,
          detail: `This link only passes through ${wrapper.displayHostname}. You would end up on ${destination.displayHostname}, so ScamCam checked that address too.`,
        },
      ];
      links.push(destination);
      current = destination;
    }
  }
  return links;
}

function linksOutsideLinkText(text: string, links: string[]): string[] {
  let outside = text;
  for (const entry of [...maskedLinks(text)].reverse()) {
    outside = `${outside.slice(0, entry.start)} ${entry.target} ${outside.slice(entry.end)}`;
  }
  return links.filter((link) => outside.includes(link));
}

function addDisguiseSignals(text: string, links: AnalyzedLink[]): void {
  for (const entry of maskedLinks(text)) {
    const target = analyzeLink(entry.target);
    const destination = links.find((link) => link.href !== null && link.href === target.href);
    const shownLink = extractInput(entry.shown).links[0];
    if (!destination?.hostname || destination.officialBrand || !shownLink) {
      continue;
    }
    const shown = analyzeLink(shownLink);
    if (!shown.hostname || shown.registrableDomain === destination.registrableDomain) {
      continue;
    }
    const shownName = shown.displayHostname ?? shown.hostname;
    destination.signals.push({
      id: `disguised-${destination.hostname}`,
      source: sourceNames.domain,
      link: destination.hostname,
      direction: "raises",
      strength: "critical",
      pretendsToBe: shownName,
      ...(shown.officialBrand ? { brandId: shown.officialBrand.id } : {}),
      title: `Shows ${shownName} but opens ${destination.displayHostname}`,
      detail: `The link text is written to look like ${shownName}, but clicking it opens ${destination.displayHostname}. Discord, email, and many other apps let anyone put a different address behind link text.`,
    });
  }
}

function markPictureLinks(links: AnalyzedLink[], originals: string[], qrTexts: string[]): Set<AnalyzedLink> {
  const fromPicture = new Set<AnalyzedLink>();
  for (const link of links) {
    if (!link.hostname || !originals.includes(link.original) || qrTexts.some((value) => value.includes(link.original))) {
      continue;
    }
    fromPicture.add(link);
    if (link.signals.some((signal) => signal.direction === "lowers")) {
      link.signals = [
        ...link.signals.filter((signal) => signal.direction !== "lowers"),
        {
          id: `picture-${link.hostname}`,
          source: sourceNames.domain,
          link: link.hostname,
          direction: "context",
          strength: "weak",
          title: `${link.displayHostname} is only what the screenshot shows`,
          detail: "Chat apps and email can show one address and open another. A screenshot only shows the text, so ScamCam does not count this link as official. Copy the link itself and check it here instead.",
        },
      ];
    }
  }
  return fromPicture;
}

function brandMismatchSignals(link: AnalyzedLink, named: ReturnType<typeof brandsNamedIn>, hasScamFamily: boolean): Signal[] {
  const brandRelated = link.brandsMentioned.length > 0 || link.signals.some((signal) => signal.lookalike);
  if (named.length === 0 || !link.hostname || link.officialBrand || link.communitySite || brandRelated) {
    return [];
  }
  const names = named.map((brand) => brand.name).join(" and ");
  return [
    {
      id: `brand-mismatch-${link.hostname}`,
      source: sourceNames.message,
      link: link.hostname,
      direction: "raises",
      strength: hasScamFamily ? "moderate" : "weak",
      brandId: named[0]!.id,
      title: `The message is about ${names}, but this link is not a ${names} address`,
      detail: `${link.registrableDomain ?? link.hostname} does not belong to ${names}. Scam messages often name a service you trust, then link somewhere else.`,
    },
  ];
}

function threatfoxSignals(link: AnalyzedLink, name: string, result: ThreatfoxResult): Signal[] {
  if (result.status !== "ok" || !result.listed) {
    return [];
  }
  const base = { source: sourceNames.threatfox, sourceUrl: threatfoxHomePage, link: link.hostname! };
  const malware = result.malware ? ` used by ${result.malware}` : "";
  if (isSharedHost(link)) {
    return [{ ...base, id: `threatfox-shared-${name}`, direction: "context", strength: "weak", title: "Malware has used this service before", detail: `ThreatFox lists ${name} as malware infrastructure${malware}. Anyone can use this service, so check what this exact link is.` }];
  }
  return [
    {
      ...base,
      id: `threatfox-${name}`,
      direction: "raises",
      strength: result.confidence >= 50 ? "critical" : "strong",
      ...(result.confidence >= 90 ? { confirms: true } : {}),
      title: `ThreatFox lists ${name} as malware infrastructure`,
      detail: `abuse.ch's ThreatFox tracks servers that malware uses, such as control servers and download sites. This one is listed${malware}, with ${result.confidence}% confidence.`,
    },
  ];
}

function urlhausSignals(link: AnalyzedLink, result: UrlhausResult): Signal[] {
  if (result.status !== "ok" || !result.listed) {
    return [];
  }
  const host = link.hostname!;
  const base = { source: sourceNames.urlhaus, sourceUrl: urlhausHomePage, link: host };
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

const dblKindNames: Record<DblListing["kind"], string> = {
  spam: "spam",
  phishing: "phishing",
  malware: "malware",
  botnet: "botnet control",
  redirector: "redirecting people to spam",
};

function spamhausSignals(link: AnalyzedLink, domain: string, result: SpamhausResult): Signal[] {
  if (result.status !== "ok") {
    return [];
  }
  const signals: Signal[] = [];
  const base = { source: sourceNames.spamhaus, link: link.hostname! };
  const listing = result.dbl;
  if (listing) {
    const kind = dblKindNames[listing.kind];
    if (listing.abused) {
      signals.push({
        ...base,
        sourceUrl: spamhausDblUrl,
        id: `spamhaus-abused-${domain}`,
        direction: "raises",
        strength: listing.kind === "spam" || listing.kind === "redirector" ? "moderate" : "strong",
        title: `Spamhaus says ${domain} is a real site being abused for ${kind}`,
        detail: `Spamhaus's Domain Blocklist marks ${domain} as a legitimate site that is being misused, for example after a break-in. Be careful with links to it until it is cleaned up.`,
      });
    } else if (isBroadName(domain)) {
      signals.push({
        ...base,
        sourceUrl: spamhausDblUrl,
        id: `spamhaus-shared-${domain}`,
        direction: "context",
        strength: "weak",
        title: `Spamhaus lists ${domain} for ${kind}`,
        detail: "Anyone can use this service, so the listing may come from other people's links. Check what this exact link is.",
      });
    } else {
      const serious = listing.kind !== "spam";
      signals.push({
        ...base,
        sourceUrl: spamhausDblUrl,
        id: `spamhaus-${domain}`,
        direction: "raises",
        strength: serious ? "critical" : "strong",
        ...(serious ? { confirms: true } : {}),
        title: `Spamhaus lists ${domain} as a ${kind} domain`,
        detail: `Spamhaus, a nonprofit that has tracked spam and cybercrime since 1998, lists this domain in its Domain Blocklist for ${kind}.`,
      });
    }
  }
  if (result.zrd) {
    const hours = result.zrd.hoursAgo;
    signals.push({
      ...base,
      sourceUrl: spamhausZrdUrl,
      id: `spamhaus-new-${domain}`,
      direction: "raises",
      strength: "moderate",
      title: hours ? `Spamhaus first saw ${domain} about ${hours} hours ago` : `Spamhaus first saw ${domain} in the last day`,
      detail: "Spamhaus noticed this domain for the first time in the last 24 hours. Brand-new domains are often made for scams and dropped soon after.",
    });
  }
  return signals;
}

function phoneReportSignals(matched: number, result: DomainListResult, now: Date): Signal[] {
  if (matched === 0 || result.status !== "ok") {
    return [];
  }
  return [
    {
      id: "ftc-dnc",
      source: sourceNames.phoneReports,
      sourceUrl: domainListDetails.ftc_dnc.url,
      direction: "raises",
      strength: "moderate",
      title: matched === 1 ? "A phone number in this message was reported to the FTC for unwanted calls" : `${matched} phone numbers in this message were reported to the FTC for unwanted calls`,
      detail: `People told the Federal Trade Commission in the last month that calls from ${matched === 1 ? "this number were" : "these numbers were"} unwanted, such as robocalls or scam calls. The FTC does not check these reports, and callers can fake a number, so treat this as one warning sign.${listDateNote(result.syncedAt, now)}`,
    },
  ];
}

function phoneComplaintSignals(matched: number, result: DomainListResult, alsoReported: boolean, now: Date): Signal[] {
  if (matched === 0 || result.status !== "ok") {
    return [];
  }
  return [
    {
      id: "fcc-complaints",
      source: sourceNames.phoneComplaints,
      sourceUrl: domainListDetails.fcc_complaints.url,
      direction: "raises",
      strength: alsoReported ? "weak" : "moderate",
      title:
        matched === 1
          ? "A phone number in this message was named in complaints to the FCC about unwanted calls"
          : `${matched} phone numbers in this message were named in complaints to the FCC about unwanted calls`,
      detail: `People named ${matched === 1 ? "this number" : "these numbers"} as the caller ID or the number to call back in complaints to the Federal Communications Commission in the last three months. The FCC does not check complaints, and callers can fake a number, so treat this as one warning sign.${listDateNote(result.syncedAt, now)}`,
    },
  ];
}

function walletSignals(matched: number, result: DomainListResult, now: Date): Signal[] {
  if (matched === 0 || result.status !== "ok") {
    return [];
  }
  return [
    {
      id: "scam-wallet",
      source: domainListDetails.scamsniffer_wallets.source,
      sourceUrl: domainListDetails.scamsniffer_wallets.url,
      direction: "raises",
      strength: "strong",
      family: "wallet_drainer",
      title: matched === 1 ? "A wallet address in this message is on ScamSniffer's scam list" : `${matched} wallet addresses in this message are on ScamSniffer's scam list`,
      detail: `ScamSniffer lists ${matched === 1 ? "this address" : "these addresses"} as used by crypto drainers or other scams to collect stolen funds. Do not send anything to it or approve anything it asks for. Lists like this can contain mistakes, so ScamCam treats one listing as a warning sign, not proof.${listDateNote(result.syncedAt, now)}`,
    },
  ];
}

function longDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function phishstatsSignals(link: AnalyzedLink, result: PhishstatsResult, now: Date): Signal[] {
  if (result.status !== "ok") {
    return [];
  }
  const host = link.hostname!;
  const domain = link.registrableDomain ?? host;
  const base = { source: sourceNames.phishstats, sourceUrl: phishstatsHomePage, link: host };
  const recent = (reportDay: string | null) => reportDay !== null && now.getTime() - Date.parse(`${reportDay}T00:00:00Z`) <= recentReportDays * day;
  const shared = isBroadName(host) || isBroadName(domain) || (result.popular && !link.isPrivateSuffix);
  const count = (reports: number) => `${reports}${reports >= 30 ? " or more" : ""} report${reports === 1 ? "" : "s"}`;
  if (result.exactHost.reports > 0) {
    const latest = result.exactHost.latest;
    if (shared) {
      return [{ ...base, id: `phishstats-shared-${host}`, direction: "context", strength: "weak", title: `Phishing pages have been reported on ${link.displayHostname}`, detail: "PhishStats has reports of phishing pages on this popular service. Anyone can post there, so check what this exact link is." }];
    }
    return [
      {
        ...base,
        id: `phishstats-${host}`,
        direction: "raises",
        strength: recent(latest) ? "strong" : "moderate",
        title: recent(latest) ? `PhishStats has phishing reports for ${link.displayHostname}` : `${link.displayHostname} was reported for phishing in the past`,
        detail: `PhishStats collects phishing links reported by researchers and the public. It has ${count(result.exactHost.reports)} for this address${latest ? `, the latest on ${longDate(latest)}` : ""}.`,
      },
    ];
  }
  if (result.sameSite.reports > 0 && !shared) {
    const latest = result.sameSite.latest;
    return [
      {
        ...base,
        id: `phishstats-site-${domain}`,
        direction: "raises",
        strength: recent(latest) ? "moderate" : "weak",
        title: `PhishStats has phishing reports for other addresses on ${domain}`,
        detail: `PhishStats has ${count(result.sameSite.reports)} for other pages on ${domain}${latest ? `, the latest on ${longDate(latest)}` : ""}. This exact address is not among them.`,
      },
    ];
  }
  return [];
}

function radarSignals(link: AnalyzedLink, domain: string, result: RadarResult): Signal[] {
  if (result.status !== "ok" || !isPopular(result) || result.top === null) {
    return [];
  }
  const place = result.top <= 100 ? `number ${result.top}` : `in the top ${result.top.toLocaleString("en-US")}`;
  return [
    {
      id: `radar-popular-${domain}`,
      source: sourceNames.radar,
      sourceUrl: radarHomePage,
      link: link.hostname!,
      direction: "lowers",
      strength: "moderate",
      title: `${domain} is one of the most visited sites (${place} on Cloudflare Radar)`,
      detail: "Cloudflare Radar ranks domains by real traffic. Very popular sites are rarely made for scams, but they can still be hacked or misused, so this does not prove a link is safe. Ranking data from Cloudflare Radar, CC BY-NC 4.0.",
    },
  ];
}

function monthAndYear(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function breachSignals(link: AnalyzedLink, entries: BreachEntry[]): Signal[] {
  const latest = entries[0];
  const domain = link.registrableDomain;
  if (!latest || !domain) {
    return [];
  }
  return [
    {
      id: `breach-${domain}`,
      source: sourceNames.breaches,
      sourceUrl: hibpBreachUrl(latest.name),
      link: link.hostname!,
      direction: "context",
      strength: "weak",
      title:
        entries.length === 1
          ? `${latest.title} had a data breach in ${monthAndYear(latest.breachDate)}`
          : `${domain} has had ${entries.length} known data breaches, the latest in ${monthAndYear(latest.breachDate)}`,
      detail: `Have I Been Pwned lists a breach of ${latest.title} that exposed ${latest.accounts.toLocaleString("en-US")} accounts. A past breach does not make this link a scam, but scammers send fake "secure your account" messages after big breaches, so open the site yourself instead of following a link. Breach data from Have I Been Pwned, CC BY 4.0.`,
    },
  ];
}

function daysSince(iso: string | null, now: Date): number | null {
  const days = iso ? Math.floor((now.getTime() - Date.parse(iso)) / day) : Number.NaN;
  return Number.isFinite(days) && days >= 0 ? days : null;
}

function madeAgo(days: number): string {
  return days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;
}

function discordSignals(link: AnalyzedLink, result: DiscordInviteResult, now: Date, fromPicture: boolean): Signal[] {
  const code = link.discordInvite!;
  const base = { source: sourceNames.discord, sourceUrl: discordInviteDocs, link: link.hostname! };
  if (result.status === "missing") {
    return [
      {
        ...base,
        id: `discord-gone-${code}`,
        direction: "context",
        strength: "moderate",
        title: "This Discord invite does not work anymore",
        detail: "The invite has expired or its server was deleted. Scam servers are often removed after reports, and their invites stop working.",
      },
    ];
  }
  if (result.status !== "ok") {
    return [];
  }
  const signals: Signal[] = [];
  const claimed = brands.find((brand) => brand.id === result.claimsBrand);
  if (claimed && !result.verified) {
    signals.push({
      ...base,
      id: `discord-impostor-${code}`,
      direction: "raises",
      strength: "strong",
      brandId: claimed.id,
      title: `This server's name claims to be ${claimed.name} staff or support`,
      detail: `Discord has not verified it as an official ${claimed.name} server. Fake support and staff servers are used to steal accounts, so do not log in, scan QR codes, or run anything they send you.`,
    });
  }
  const age = daysSince(result.createdAt, now);
  if (age !== null && age < newAccountDays) {
    signals.push({
      ...base,
      id: `discord-new-${code}`,
      direction: "raises",
      strength: "weak",
      title: `This Discord server was made ${madeAgo(age)}`,
      detail: "Fake giveaway and support servers are usually new, because Discord removes them after reports. Many honest servers are new too.",
    });
  }
  if (fromPicture) {
    return signals;
  }
  if (result.verified) {
    signals.push({
      ...base,
      id: `discord-verified-${code}`,
      direction: "lowers",
      strength: "moderate",
      title: "Discord has verified this server",
      detail: "Discord verifies the official servers of games, companies, and creators. People inside it can still send scams, so be careful with direct messages from members.",
    });
  } else if (result.partnered) {
    signals.push({
      ...base,
      id: `discord-partner-${code}`,
      direction: "lowers",
      strength: "weak",
      title: "This is a Discord Partner server",
      detail: "Discord chose it for its Partner Program, which is for active, well-run communities. People inside it can still send scams, so be careful with direct messages from members.",
    });
  }
  return signals;
}

function steamSignals(link: AnalyzedLink, result: SteamAccountResult, now: Date): Signal[] {
  const ref = link.steamAccount!;
  const account = `${ref.kind}-${ref.value.toLowerCase()}`;
  const base = { source: sourceNames.steam, sourceUrl: steamHomePage, link: link.hostname! };
  if (result.status === "missing") {
    return [
      {
        ...base,
        id: `steam-missing-${account}`,
        direction: "context",
        strength: "weak",
        title: "This Steam profile does not exist",
        detail: "Steam has no account at this address. It may have been deleted, or the link is wrong.",
      },
    ];
  }
  if (result.status !== "ok") {
    return [];
  }
  const signals: Signal[] = [];
  if (result.tradeBan === "banned") {
    signals.push({
      ...base,
      id: `steam-trade-ban-${account}`,
      direction: "raises",
      strength: "strong",
      title: "Steam has banned this account from trading",
      detail: "Steam bans trading on accounts involved in scams, stolen items, or other trading abuse. Do not trade with it or open links it sends you.",
    });
  } else if (result.tradeBan === "probation") {
    signals.push({
      ...base,
      id: `steam-trade-probation-${account}`,
      direction: "raises",
      strength: "moderate",
      title: "This Steam account is on trade probation",
      detail: "Steam limits trading on this account after a trading problem. Be careful with any trade it offers.",
    });
  }
  if (result.communityBanned) {
    signals.push({
      ...base,
      id: `steam-community-ban-${account}`,
      direction: "raises",
      strength: "moderate",
      title: "Steam has banned this account from its community",
      detail: "Steam bans accounts from its community features for breaking the rules, for example by spamming or scamming.",
    });
  }
  const claimed = brands.find((brand) => brand.id === result.claimsBrand);
  if (claimed) {
    signals.push({
      ...base,
      id: `steam-impostor-${account}`,
      direction: "raises",
      strength: "strong",
      brandId: claimed.id,
      title: `This Steam account's name claims to be ${claimed.name} staff or support`,
      detail: `Real ${claimed.name} staff never add you as a friend or message you on Steam about your account. Names like this are used in fake support and fake report scams.`,
    });
  }
  const age = daysSince(result.createdAt, now);
  if (age !== null && age < newAccountDays) {
    signals.push({
      ...base,
      id: `steam-new-${account}`,
      direction: "raises",
      strength: "moderate",
      title: `This Steam account was made ${madeAgo(age)}`,
      detail: "Scammers often use new accounts, because their old ones get banned. Many honest players are new too.",
    });
  }
  if (result.gameBans > 0) {
    signals.push({
      ...base,
      id: `steam-game-bans-${account}`,
      direction: "context",
      strength: "weak",
      title: `This Steam account has ${result.gameBans} game ban${result.gameBans === 1 ? "" : "s"}`,
      detail: "Game and anti-cheat bans are for cheating, not scams, so this only describes the account's history.",
    });
  }
  if (signals.length === 0) {
    const years = age !== null && age >= 365 ? Math.floor(age / 365) : null;
    signals.push({
      ...base,
      id: `steam-clean-${account}`,
      direction: "context",
      strength: "weak",
      title: years ? `Steam shows no bans on this account, made ${years} year${years === 1 ? "" : "s"} ago` : "Steam shows no bans on this account",
      detail: "Steam reports no trade, community, or game bans. Clean accounts can still be stolen or used for scams, so this does not show that the person is trustworthy.",
    });
  }
  return signals;
}

const shortLinkServices: Record<ShortLinkService, { name: string; source: string; url: string }> = {
  bitly: { name: "Bitly", source: sourceNames.bitly, url: bitlyHomePage },
  isgd: { name: "is.gd", source: sourceNames.isgd, url: isgdHomePage },
};

function refFor(link: AnalyzedLink): ShortLinkRef | null {
  if (!link.href) {
    return null;
  }
  try {
    return shortLinkRef(link.hostname, new URL(link.href).pathname);
  } catch {
    return null;
  }
}

async function expandShortLinks(links: AnalyzedLink[], wrappers: Set<AnalyzedLink>, options: ScanOptions, lookups: Lookups): Promise<UncheckedSource[]> {
  const candidates = uniqueBy(links, (link) => {
    const ref = refFor(link);
    return ref ? `${ref.host}/${ref.code}` : null;
  }).slice(0, maxExpandedLinks);
  const results = await Promise.all(candidates.map((link) => expandShortLink(refFor(link)!, { fetcher: options.fetcher, lookups, bitlyToken: options.bitlyToken })));
  const gaps: UncheckedSource[] = [];
  for (const [index, short] of candidates.entries()) {
    const result = results[index]!;
    const ref = refFor(short)!;
    const service = shortLinkServices[ref.service];
    const base = { source: service.source, sourceUrl: service.url, link: short.hostname! };
    if (result.status === "not_configured" || result.status === "unavailable") {
      gaps.push({ name: service.source, reason: result.status });
      continue;
    }
    if (result.status === "disabled") {
      short.signals.push({
        ...base,
        id: `short-disabled-${ref.host}-${ref.code}`,
        direction: "raises",
        strength: "strong",
        title: `${service.name} has disabled this short link`,
        detail: `${service.name} turns off short links that were used for spam, phishing, or other abuse.`,
      });
      continue;
    }
    if (result.status === "missing") {
      short.signals.push({
        ...base,
        id: `short-missing-${ref.host}-${ref.code}`,
        direction: "context",
        strength: "weak",
        title: "This short link does not exist anymore",
        detail: `${service.name} has no link with this code. It may have been removed after reports, or the link is mistyped.`,
      });
      continue;
    }
    const destinations = withDestinations([result.target], wrappers).filter((destination) => destination.hostname && !links.some((link) => link.href === destination.href));
    const first = destinations[0];
    if (!first) {
      continue;
    }
    links.push(...destinations);
    wrappers.add(short);
    short.signals = [
      ...short.signals.filter((signal) => !signal.id.startsWith("shortener-") && signal.direction !== "lowers"),
      {
        ...base,
        id: `expanded-${ref.host}-${ref.code}`,
        direction: "context",
        strength: "weak",
        title: `${service.name} says this short link goes to ${first.displayHostname}`,
        detail: `ScamCam asked ${service.name} where the link leads, without opening it, and checked that address too.`,
      },
    ];
  }
  return gaps;
}

function uniqueBy(links: AnalyzedLink[], keyOf: (link: AnalyzedLink) => string | null): AnalyzedLink[] {
  const seen = new Map<string, AnalyzedLink>();
  for (const link of links) {
    const key = keyOf(link);
    if (key !== null && !seen.has(key)) {
      seen.set(key, link);
    }
  }
  return [...seen.values()];
}

function isBroadName(name: string): boolean {
  return (
    urlShorteners.has(name) ||
    userContentHosts.includes(name) ||
    freeHostOf(name) === name ||
    Boolean(officialBrandFor(name))
  );
}

function listDateNote(syncedAt: number, now: Date): string {
  if (now.getTime() / 1000 - syncedAt < 36 * 60 * 60) {
    return "";
  }
  const date = new Date(syncedAt * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return ` The copy ScamCam checked was published on ${date}.`;
}

function listSignals(list: DomainListName, link: AnalyzedLink, names: string[], result: DomainListResult, isWrapper: boolean, now: Date): Signal[] {
  if (result.status !== "ok") {
    return [];
  }
  const matched = names.find((name) => result.listed.has(name));
  if (!matched) {
    return [];
  }
  const details = domainListDetails[list];
  const prefix = list === "phishing_database" ? "pdb" : `list-${list}`;
  const shown = matched === link.hostname ? (link.displayHostname ?? matched) : matched;
  const base = { source: details.source, sourceUrl: details.url, link: link.hostname! };
  const dated = listDateNote(result.syncedAt, now);
  if (isBroadName(matched) || isWrapper || isRedirectorHost(link.hostname ?? "")) {
    return [
      {
        ...base,
        id: `${prefix}-shared-${matched}`,
        direction: "context",
        strength: "weak",
        title: `${shown} appears on a community scam list`,
        detail: `${details.source} lists this service, but it is shared by many people or only passes links on, so it says little about this exact link. ScamCam checks where a redirect leads separately.${dated}`,
      },
    ];
  }
  return [
    {
      ...base,
      id: `${prefix}-${matched}`,
      direction: "raises",
      strength: "strong",
      title: details.title.replace("{name}", shown),
      detail: `${details.about} Lists like this can contain mistakes, so ScamCam treats one listing as a warning sign, not proof.${dated}`,
    },
  ];
}

function hiddenCharacterSignals(hidden: ReturnType<typeof extractInput>["hidden"]): Signal[] {
  const base = { source: sourceNames.message };
  const signals: Signal[] = [];
  if (hidden.direction > 0) {
    signals.push({
      ...base,
      id: "hidden-direction",
      direction: "raises",
      strength: "strong",
      title: "Contains characters that flip the text direction",
      detail: "Invisible direction controls can make a file or link name read differently from what it really is, for example a program that looks like a picture.",
    });
  }
  if (hidden.inLinks > 0) {
    signals.push({
      ...base,
      id: "hidden-in-link",
      direction: "raises",
      strength: "strong",
      title: "A link has invisible characters inside it",
      detail: "Invisible characters inside a web address are used to slip past link filters. The real address may not be what it looks like.",
    });
  } else if (hidden.inWords > 0) {
    signals.push({
      ...base,
      id: "hidden-in-words",
      direction: "raises",
      strength: "moderate",
      title: "Contains invisible characters inside words",
      detail: "Scammers hide invisible characters inside words so that chat filters miss them. ScamCam removed them before checking.",
    });
  }
  if (hidden.smuggled > 0) {
    signals.push({
      ...base,
      id: "hidden-data",
      direction: "raises",
      strength: "moderate",
      title: "Contains hidden data",
      detail: "The message carries invisible characters that can hide text or instructions. ScamCam removed them before checking.",
    });
  }
  return signals;
}

function aiSignal(label: ScamFamily): Signal {
  return {
    id: `ai-${label}`,
    source: sourceNames.ai,
    direction: "raises",
    strength: "strong",
    family: label,
    title: `An AI check thinks this looks like the ${familyNames[label]} scam`,
    detail: "A small AI model compared the message with common gaming scams. It can be wrong, so treat this as one warning sign and read the rest of the report.",
  };
}

function isReviewResult(value: unknown): value is AiReviewResult {
  return typeof value === "object" && value !== null && (value as AiReviewResult).status === "ok";
}

async function reviewWithMemory(text: string, review: (text: string) => Promise<AiReviewResult>, lookups: Lookups): Promise<AiReviewResult> {
  const key = await cacheKey("ai-review", text);
  const remembered = recallFromMemory(lookups, key);
  if (isReviewResult(remembered)) {
    return remembered;
  }
  if (!sourceIsOpen(lookups, aiSource)) {
    return { status: "unavailable" };
  }
  const result = await review(text);
  if (result.status !== "over_budget") {
    recordOutcome(lookups, aiSource, result.status !== "unavailable");
  }
  if (result.status === "ok") {
    rememberInMemory(lookups, key, result, aiMemorySeconds);
  }
  return result;
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
  const lookups = options.lookups ?? memoryLookups();
  const checkedAt = now.toISOString();
  const extracted = extractInput(content);
  const realLinks = linksOutsideLinkText(extracted.redactedText, extracted.links);
  const wrappers = new Set<AnalyzedLink>();
  const links = withDestinations(realLinks, wrappers);
  const expansionGaps = options.extendedLookups ? await expandShortLinks(links, wrappers, options, lookups) : [];
  addDisguiseSignals(extracted.redactedText, links);
  const pictureLinks = options.fromScreenshot ? markPictureLinks(links, realLinks, qrValues(extracted.redactedText)) : new Set<AnalyzedLink>();
  const readable = links.filter((link) => link.hostname);
  let messageText = withoutQrLabels(extracted.redactedText);
  for (const link of extracted.links) {
    messageText = messageText.split(link).join(" [link] ");
  }
  const message = analyzeMessage(messageText);
  const targetsCheckers = aimsAtCheckers(messageText);
  const sender = senderLink(options.email);
  const ruleSignals = [
    ...message.signals,
    ...(options.email ? emailSignals(options.email, sender, senderNameIn(extracted.redactedText)) : []),
    ...hiddenCharacterSignals(extracted.hidden),
    ...(targetsCheckers
      ? [
          {
            id: "checker-instructions",
            source: sourceNames.message,
            direction: "raises",
            strength: "strong",
            title: "Tries to tell automated checkers what to answer",
            detail: "The message contains text aimed at scam filters or AI checkers, such as fake system notes or answers to give. Ordinary messages do not do that, so ScamCam did not ask its AI about it.",
          } satisfies Signal,
        ]
      : []),
  ];
  const urlOnly = extracted.links.length === 1 && messageText.replaceAll("[link]", "").trim() === "";
  const networkLinks = pickNetworkLinks(readable);
  const notChecked: UncheckedSource[] = [...expansionGaps];
  const extraSignals = new Map<AnalyzedLink, Signal[]>();
  const attach = (link: AnalyzedLink, signals: Signal[]) => extraSignals.set(link, [...(extraSignals.get(link) ?? []), ...signals]);
  const generalSignals: Signal[] = [];
  const popularLinks = new Set<AnalyzedLink>();

  let safeBrowsing: SafeBrowsingResult | null = null;
  const tasks: Promise<void>[] = [];
  if (readable.length > 0) {
    if (!options.safeBrowsingKey) {
      notChecked.push({ name: sourceNames.safeBrowsing, reason: "not_configured" });
    } else {
      const apiKey = options.safeBrowsingKey;
      tasks.push(
        searchSafeBrowsing(
          readable.map((link) => link.original),
          { apiKey, fetcher: options.fetcher, lookups, takeBudget: () => options.takeBudget("safe_browsing") },
        ).then((result) => {
          safeBrowsing = result;
        }),
      );
    }
  }
  if (networkLinks.length > 0) {
    if (!options.urlhausKey) {
      notChecked.push({ name: sourceNames.urlhaus, reason: "not_configured" });
    } else {
      const authKey = options.urlhausKey;
      tasks.push(
        (async () => {
          let reason: UncheckedSource["reason"] | null = null;
          const results = await Promise.all(
            networkLinks.map((link) => lookupUrlhausHost(link.hostname!, { authKey, fetcher: options.fetcher, lookups, takeBudget: () => options.takeBudget("urlhaus") })),
          );
          for (const [index, link] of networkLinks.entries()) {
            const result = results[index]!;
            if (result.status === "over_budget") {
              reason = "over_budget";
            } else if (result.status === "unavailable") {
              reason ??= "unavailable";
            }
            attach(link, urlhausSignals(link, result));
          }
          if (reason) {
            notChecked.push({ name: sourceNames.urlhaus, reason });
          }
        })(),
      );
      if (options.extendedLookups) {
        tasks.push(
          (async () => {
            let reason: UncheckedSource["reason"] | null = null;
            const names = networkLinks.map((link) => link.registrableDomain ?? link.hostname!);
            const results = await Promise.all(names.map((name) => lookupThreatfoxHost(name, { authKey, fetcher: options.fetcher, lookups, takeBudget: () => options.takeBudget("urlhaus") })));
            for (const [index, link] of networkLinks.entries()) {
              const result = results[index]!;
              if (result.status === "over_budget") {
                reason = "over_budget";
              } else if (result.status === "unavailable") {
                reason ??= "unavailable";
              }
              attach(link, threatfoxSignals(link, names[index]!, result));
            }
            if (reason) {
              notChecked.push({ name: sourceNames.threatfox, reason });
            }
          })(),
        );
      }
    }
    if (options.extendedLookups) {
      const domainLinks = networkLinks.filter((link) => !link.isIp && link.registrableDomain);
      if (domainLinks.length > 0 && !options.spamhaus) {
        notChecked.push({ name: sourceNames.spamhaus, reason: "not_configured" });
      } else if (domainLinks.length > 0 && options.spamhaus) {
        const spamhaus = options.spamhaus;
        tasks.push(
          (async () => {
            const results = await lookupSpamhaus(
              domainLinks.map((link) => link.registrableDomain!),
              { key: spamhaus.key, transport: spamhaus.transport, lookups },
            );
            let missing = false;
            for (const link of domainLinks) {
              const result = results.get(link.registrableDomain!) ?? { status: "unavailable" };
              missing ||= result.status !== "ok";
              attach(link, spamhausSignals(link, link.registrableDomain!, result));
            }
            if (missing) {
              notChecked.push({ name: sourceNames.spamhaus, reason: "unavailable" });
            }
          })(),
        );
      }
      const topLink = domainLinks[0];
      if (topLink && !options.phishstatsKey) {
        notChecked.push({ name: sourceNames.phishstats, reason: "not_configured" });
      } else if (topLink && options.phishstatsKey) {
        const apiKey = options.phishstatsKey;
        tasks.push(
          (async () => {
            const result = await lookupPhishstats(
              { hostname: topLink.hostname!, registrableDomain: topLink.registrableDomain!, privateSuffix: topLink.isPrivateSuffix },
              { apiKey, fetcher: options.fetcher, lookups, takeBudget: () => options.takeBudget("phishstats") },
            );
            if (result.status === "over_budget" || result.status === "unavailable") {
              notChecked.push({ name: sourceNames.phishstats, reason: result.status });
            }
            attach(topLink, phishstatsSignals(topLink, result, now));
          })(),
        );
      }
      if (options.radarToken) {
        const token = options.radarToken;
        const rankable = domainLinks.filter((link) => !link.isPrivateSuffix && !link.communitySite && !isSharedHost(link)).slice(0, maxRadarLinks);
        tasks.push(
          (async () => {
            await Promise.all(
              rankable.map(async (link) => {
                const result = await lookupRadar(link.registrableDomain!, { token, fetcher: options.fetcher, lookups });
                if (isPopular(result)) {
                  popularLinks.add(link);
                  attach(link, radarSignals(link, link.registrableDomain!, result));
                }
              }),
            );
          })(),
        );
      }
    }
    tasks.push(
      (async () => {
        const results = await Promise.all(
          networkLinks.map(async (link) => {
            if (link.isIp || link.isPrivateSuffix || link.communitySite || !link.registrableDomain) {
              return true;
            }
            const result = await lookupRdap(link.registrableDomain, options.fetcher, lookups);
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
            const result = await lookupHost(link.hostname!, options.fetcher, lookups);
            attach(link, [...dnsSignals(link, result), ...filterSignals(link, result)]);
            return result.status !== "unavailable";
          }),
        );
        if (results.some((ok) => !ok)) {
          notChecked.push({ name: sourceNames.dnsFilter, reason: "unavailable" });
        }
      })(),
    );
  }
  if (options.extendedLookups) {
    const invites = uniqueBy(readable, (link) => link.discordInvite).slice(0, maxDiscordInvites);
    if (invites.length > 0) {
      tasks.push(
        (async () => {
          const results = await Promise.all(invites.map((link) => lookupDiscordInvite(link.discordInvite!, { fetcher: options.fetcher, lookups, botToken: options.discordToken })));
          for (const [index, link] of invites.entries()) {
            attach(link, discordSignals(link, results[index]!, now, pictureLinks.has(link)));
          }
          if (results.some((result) => result.status === "unavailable")) {
            notChecked.push({ name: sourceNames.discord, reason: "unavailable" });
          }
        })(),
      );
    }
    const accounts = uniqueBy(readable, (link) => (link.steamAccount ? `${link.steamAccount.kind}:${link.steamAccount.value.toLowerCase()}` : null)).slice(0, maxSteamAccounts);
    if (accounts.length > 0 && !options.steamKey) {
      notChecked.push({ name: sourceNames.steam, reason: "not_configured" });
    } else if (accounts.length > 0 && options.steamKey) {
      const key = options.steamKey;
      tasks.push(
        (async () => {
          const results = await lookupSteamAccounts(
            accounts.map((link) => link.steamAccount!),
            { key, fetcher: options.fetcher, lookups },
          );
          for (const [index, link] of accounts.entries()) {
            attach(link, steamSignals(link, results[index]!, now));
          }
          if (results.some((result) => result.status === "unavailable")) {
            notChecked.push({ name: sourceNames.steam, reason: "unavailable" });
          }
        })(),
      );
    }
  }
  const listedLinks = readable.filter((link) => !link.officialBrand).slice(0, maxListedLinks);
  const phones = extracted.phones;
  const wallets = extracted.wallets;
  const senderNames = sender && !sender.officialBrand ? candidateNames(sender.hostname!, sender.registrableDomain) : [];
  const listMatchSignals: Signal[] = [];
  if (listedLinks.length > 0 || phones.length > 0 || wallets.length > 0 || senderNames.length > 0) {
    if (!options.scamLists) {
      if (listedLinks.length > 0 || senderNames.length > 0) {
        notChecked.push({ name: sourceNames.scamLists, reason: "not_configured" });
      }
      if (phones.length > 0) {
        notChecked.push({ name: sourceNames.phoneReports, reason: "not_configured" });
        notChecked.push({ name: sourceNames.phoneComplaints, reason: "not_configured" });
      }
      if (wallets.length > 0) {
        notChecked.push({ name: domainListDetails.scamsniffer_wallets.source, reason: "not_configured" });
      }
    } else {
      const lists = options.scamLists;
      tasks.push(
        (async () => {
          const namesByLink = new Map(listedLinks.map((link) => [link, candidateNames(link.hostname!, link.registrableDomain)]));
          const results = await lists.lookup([...new Set([...[...namesByLink.values()].flat(), ...senderNames, ...phones, ...wallets])]);
          const domainResults = [...results].filter((entry): entry is [DomainListName, DomainListResult] => isDomainList(entry[0]));
          if (sender && senderNames.length > 0) {
            for (const [list, result] of domainResults) {
              listMatchSignals.push(
                ...listSignals(list, sender, senderNames, result, false, now).map((signal) => ({ ...signal, id: `sender-${signal.id}`, title: `Sender: ${signal.title}` })),
              );
            }
          }
          if (listedLinks.length > 0 || senderNames.length > 0) {
            const answers = domainResults.map(([, result]) => result);
            if (answers.length === 0 || answers.every((answer) => answer.status === "not_configured")) {
              notChecked.push({ name: sourceNames.scamLists, reason: "not_configured" });
            } else if (answers.every((answer) => answer.status === "unavailable")) {
              notChecked.push({ name: sourceNames.scamLists, reason: "unavailable" });
            }
            for (const [list, result] of domainResults) {
              if (result.status === "stale") {
                notChecked.push({ name: domainListDetails[list].source, reason: "out_of_date" });
              }
              for (const [link, names] of namesByLink) {
                attach(link, listSignals(list, link, names, result, wrappers.has(link), now));
              }
            }
          }
          const unchecked = (name: string, result: DomainListResult) => {
            if (result.status !== "ok") {
              notChecked.push({ name, reason: result.status === "stale" ? "out_of_date" : result.status });
            }
          };
          const matches = (result: DomainListResult, entries: string[]) => (result.status === "ok" ? entries.filter((entry) => result.listed.has(entry)).length : 0);
          if (phones.length > 0) {
            const reports = results.get("ftc_dnc") ?? { status: "not_configured" };
            const complaints = results.get("fcc_complaints") ?? { status: "not_configured" };
            const reported = matches(reports, phones);
            listMatchSignals.push(...phoneReportSignals(reported, reports, now), ...phoneComplaintSignals(matches(complaints, phones), complaints, reported > 0, now));
            unchecked(sourceNames.phoneReports, reports);
            unchecked(sourceNames.phoneComplaints, complaints);
          }
          if (wallets.length > 0) {
            const scamWallets = results.get("scamsniffer_wallets") ?? { status: "not_configured" };
            listMatchSignals.push(...walletSignals(matches(scamWallets, wallets), scamWallets, now));
            unchecked(domainListDetails.scamsniffer_wallets.source, scamWallets);
          }
        })(),
      );
    }
  }
  await Promise.all(tasks);
  for (const [link, signals] of extraSignals) {
    if (signals.some((signal) => signal.id.startsWith("rdap-new-"))) {
      extraSignals.set(
        link,
        signals.filter((signal) => !signal.id.startsWith("spamhaus-new-")),
      );
    }
  }
  for (const link of popularLinks) {
    link.signals = link.signals.filter((signal) => !signal.id.startsWith("risky-tld-"));
  }

  const safeBrowsingResult = safeBrowsing as SafeBrowsingResult | null;
  if (safeBrowsingResult?.status === "unavailable" || safeBrowsingResult?.status === "over_budget") {
    notChecked.push({ name: sourceNames.safeBrowsing, reason: safeBrowsingResult.status });
  } else if (safeBrowsingResult?.status === "ok") {
    for (const link of readable) {
      const threats = safeBrowsingResult.threats.get(link.original);
      if (threats) {
        const description = threatDescriptions[threats[0]!] ?? "a site that may be unsafe";
        const definition = threatDefinitionUrls[threats[0]!];
        attach(link, [
          {
            id: `gsb-${link.hostname}`,
            source: sourceNames.safeBrowsing,
            ...(definition ? { sourceUrl: definition } : {}),
            link: link.hostname!,
            direction: "raises",
            strength: "critical",
            fromSafeBrowsing: true,
            title: `Google Safe Browsing warns this is ${description}`,
            detail: "Google Safe Browsing lists this link as potentially unsafe. Its warnings can occasionally be wrong, but do not open the link or enter any details.",
          },
        ]);
      }
    }
    if (safeBrowsingResult.threats.size === 0 && safeBrowsingResult.complete) {
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

  const breaches = options.breaches;
  if (breaches) {
    const breached = uniqueBy(readable, (link) => (!link.isIp && link.registrableDomain && breaches.has(link.registrableDomain) ? link.registrableDomain : null));
    for (const link of breached.slice(0, maxBreachDomains)) {
      attach(link, breachSignals(link, breaches.get(link.registrableDomain!) ?? []));
    }
  }
  const namedBrands = brandsNamedIn(normalizeMessage(messageText));
  for (const link of readable) {
    if (!popularLinks.has(link)) {
      attach(link, brandMismatchSignals(link, namedBrands, message.families.length > 0));
    }
  }
  const linkSignals = links.map((link) => [...link.signals, ...(extraSignals.get(link) ?? [])]);
  const nonOfficial = readable.filter((link) => !link.officialBrand || link.discordInvite || pictureLinks.has(link));
  const verdictFor = (messageSignals: Signal[], families: ScamFamily[]) =>
    decideVerdict({
      messageSignals,
      linkSignals,
      families,
      linkCount: readable.length,
      allLinksOfficial: readable.length > 0 && nonOfficial.length === 0,
      safeBrowsingCleared:
        safeBrowsingResult?.status === "ok" && safeBrowsingResult.complete && nonOfficial.every((link) => !safeBrowsingResult.threats.has(link.original)),
      officialBrandNames: [...new Set(readable.map((link) => link.officialBrand?.name).filter((name): name is string => Boolean(name)))],
      linksFromPicture: pictureLinks.size > 0,
    });
  const baseSignals = [...ruleSignals, ...listMatchSignals];
  let messageSignals = baseSignals;
  const linkFamilies = [...linkSignals.flat(), ...listMatchSignals].flatMap((signal) => (signal.family ? [signal.family] : []));
  let verdict = verdictFor(messageSignals, [...new Set([...message.families, ...linkFamilies])]);
  const reviewText = messageText.replace(/\s+/g, " ").trim();
  const strongLinkWarning = linkSignals.some((signals) => signals.some((signal) => signal.direction === "raises" && strengthPoints[signal.strength] >= 4));
  if (
    options.aiReview &&
    !targetsCheckers &&
    reviewText.replaceAll("[link]", "").trim().length >= minReviewCharacters &&
    message.families.length === 0 &&
    !strongLinkWarning &&
    (verdict.level === "unknown" || verdict.level === "no_known_threat")
  ) {
    const review = await reviewWithMemory(reviewText, options.aiReview, lookups);
    const decodedQr = qrValues(extracted.redactedText).length > 0;
    if (review.status === "ok" && review.label !== "none" && !(review.label === "qr_takeover" && decodedQr)) {
      const label: ScamFamily = review.label;
      messageSignals = [...baseSignals, aiSignal(label)];
      verdict = verdictFor(messageSignals, [label]);
      if (verdict.level === "suspicious") {
        verdict.summary = `An AI check thinks this looks like the ${familyNames[label]} scam. Nothing else confirms it.`;
      }
    } else if (review.status === "over_budget") {
      notChecked.push({ name: sourceNames.ai, reason: "over_budget" });
    } else if (review.status !== "ok") {
      notChecked.push({ name: sourceNames.ai, reason: "unavailable" });
    }
  }
  const riskyAttachment = messageSignals.some((signal) => signal.id.startsWith("attachment-") && signal.direction === "raises" && strengthPoints[signal.strength] >= 2);
  if (riskyAttachment && ["suspicious", "high_risk", "confirmed_malicious"].includes(verdict.level)) {
    verdict.recommendations = [...new Set(["Do not open the attachments, and do not enable editing or content in them.", ...verdict.recommendations])].slice(0, 6);
  }
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
  const signals = [...messageSignals, ...linkSignals.flat(), ...generalSignals]
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
