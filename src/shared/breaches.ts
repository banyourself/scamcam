import type { BreachCatalog, BreachEntry, BreachNote } from "./api";

export const hibpHomePage = "https://haveibeenpwned.com/";
export const hibpBreachListPage = "https://haveibeenpwned.com/PwnedWebsites";
export const hibpLicenseUrl = "https://creativecommons.org/licenses/by/4.0/";

export const breachNoteLabels: Record<BreachNote, string> = {
  unverified: "Not verified by Have I Been Pwned",
  fabricated: "Likely made up, not a real breach",
  sensitive: "Sensitive breach",
  spam_list: "Spam list, not a breach of the site",
  malware: "Collected by malware, not a breach of the site",
  stealer_log: "From stealer logs, not a breach of the site",
  retired: "Retired by Have I Been Pwned",
};

export const notABreachOfTheSite: ReadonlySet<BreachNote> = new Set(["fabricated", "spam_list", "malware", "stealer_log", "retired"]);

export function hibpBreachUrl(name: string): string {
  return `https://haveibeenpwned.com/Breach/${encodeURIComponent(name)}`;
}

export function isBreachCatalog(value: unknown): value is BreachCatalog {
  const catalog = value as BreachCatalog | null;
  return (
    typeof catalog === "object" &&
    catalog !== null &&
    typeof catalog.fetchedAt === "string" &&
    Array.isArray(catalog.dataClasses) &&
    Array.isArray(catalog.breaches) &&
    catalog.breaches.every((entry) => typeof entry?.name === "string" && typeof entry.title === "string" && typeof entry.domain === "string" && Array.isArray(entry.classes) && Array.isArray(entry.notes))
  );
}

export function searchTerm(query: string): string {
  let term = query.trim().toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(term)) {
    try {
      term = new URL(term).hostname;
    } catch {
      return term;
    }
  } else if (/^[^\s/]+\.[a-z]{2,}(?:\/|$)/.test(term)) {
    term = term.split("/")[0]!;
  }
  return term.replace(/^www\./, "");
}

function rank(entry: BreachEntry, term: string): number {
  const domain = entry.domain.toLowerCase();
  const title = entry.title.toLowerCase();
  const name = entry.name.toLowerCase();
  if (domain !== "" && (domain === term || term.endsWith(`.${domain}`))) {
    return 0;
  }
  if (title === term || name === term) {
    return 1;
  }
  if (title.startsWith(term) || name.startsWith(term) || domain.startsWith(term)) {
    return 2;
  }
  if (title.includes(term) || name.includes(term) || domain.includes(term)) {
    return 3;
  }
  return -1;
}

export function searchBreaches(catalog: BreachCatalog, query: string, limit = 20): BreachEntry[] {
  const term = searchTerm(query);
  if (term.length < 2) {
    return [];
  }
  return catalog.breaches
    .map((entry) => ({ entry, score: rank(entry, term) }))
    .filter((match) => match.score >= 0)
    .sort((a, b) => a.score - b.score || b.entry.breachDate.localeCompare(a.entry.breachDate))
    .slice(0, limit)
    .map((match) => match.entry);
}
