export const siteDatasets = ["site-security", "breach-notices"] as const;
export type SiteDataset = (typeof siteDatasets)[number];

export const twoFactorMethods = ["totp", "u2f", "custom-software", "custom-hardware", "sms", "call", "email"] as const;
export type TwoFactorMethod = (typeof twoFactorMethods)[number];

export const twoFactorLabels: Record<TwoFactorMethod, string> = {
  totp: "an authenticator app",
  u2f: "a security key",
  "custom-software": "the site's own app",
  "custom-hardware": "the site's own hardware key",
  sms: "text messages",
  call: "phone calls",
  email: "email codes",
};

export const passkeySignIn = 1;
export const passkeySecondStep = 2;

export interface SiteEntry {
  d: string;
  m?: number;
  sw?: string[];
  hw?: string[];
  doc?: string;
  rec?: string;
  note?: string;
  pk?: number;
  pkDoc?: string;
  pkNote?: string;
  cp?: string;
}

export interface SiteSecurity {
  v: 1;
  builtAt: string;
  sites: SiteEntry[];
}

export const noticeSources = {
  wa: { name: "Washington State Attorney General", list: "https://www.atg.wa.gov/data-breach-notifications", residents: "Washington residents" },
  ca: { name: "California Attorney General", list: "https://oag.ca.gov/privacy/databreach/list", residents: "California residents" },
} as const;
export type NoticeSource = keyof typeof noticeSources;

export interface BreachNotice {
  s: NoticeSource;
  n: string;
  r: string;
  b?: string[];
  a?: number;
  c?: string;
}

export interface BreachNotices {
  v: 1;
  builtAt: string;
  notices: BreachNotice[];
}

export const twoFactorDirectoryUrl = "https://2fa.directory/";
export const passkeysDirectoryUrl = "https://passkeys.2fa.directory/";
export const changePasswordListUrl = "https://github.com/apple/password-manager-resources";

const isoDay = /^\d{4}-\d{2}-\d{2}$/;

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isSiteEntry(value: unknown): value is SiteEntry {
  const entry = value as SiteEntry | null;
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof entry.d === "string" &&
    (entry.m === undefined || typeof entry.m === "number") &&
    optionalString(entry.doc) &&
    optionalString(entry.rec) &&
    optionalString(entry.note) &&
    optionalString(entry.pkDoc) &&
    optionalString(entry.pkNote) &&
    optionalString(entry.cp) &&
    (entry.pk === undefined || typeof entry.pk === "number") &&
    (entry.sw === undefined || (Array.isArray(entry.sw) && entry.sw.every((name) => typeof name === "string"))) &&
    (entry.hw === undefined || (Array.isArray(entry.hw) && entry.hw.every((name) => typeof name === "string")))
  );
}

export function isSiteSecurity(value: unknown): value is SiteSecurity {
  const data = value as SiteSecurity | null;
  return typeof data === "object" && data !== null && data.v === 1 && typeof data.builtAt === "string" && Array.isArray(data.sites) && data.sites.every(isSiteEntry);
}

function isNotice(value: unknown): value is BreachNotice {
  const notice = value as BreachNotice | null;
  return (
    typeof notice === "object" &&
    notice !== null &&
    (notice.s === "wa" || notice.s === "ca") &&
    typeof notice.n === "string" &&
    typeof notice.r === "string" &&
    isoDay.test(notice.r) &&
    (notice.b === undefined || (Array.isArray(notice.b) && notice.b.every((day) => typeof day === "string" && isoDay.test(day)))) &&
    (notice.a === undefined || (typeof notice.a === "number" && Number.isInteger(notice.a) && notice.a >= 0)) &&
    optionalString(notice.c)
  );
}

export function isBreachNotices(value: unknown): value is BreachNotices {
  const data = value as BreachNotices | null;
  return typeof data === "object" && data !== null && data.v === 1 && typeof data.builtAt === "string" && Array.isArray(data.notices) && data.notices.every(isNotice);
}

export function methodsOf(mask: number): TwoFactorMethod[] {
  return twoFactorMethods.filter((method) => (mask & (1 << twoFactorMethods.indexOf(method))) !== 0);
}

export function maskOf(methods: readonly string[]): number {
  return methods.reduce((mask, method) => {
    const index = twoFactorMethods.indexOf(method as TwoFactorMethod);
    return index >= 0 ? mask | (1 << index) : mask;
  }, 0);
}

function domainRank(domain: string, term: string): number {
  if (domain === term || term.endsWith(`.${domain}`)) {
    return 0;
  }
  const label = domain.split(".")[0]!;
  if (label === term) {
    return 1;
  }
  if (domain.startsWith(term)) {
    return 2;
  }
  return domain.includes(term) ? 3 : -1;
}

export function searchSites(data: SiteSecurity, term: string, limit = 5): SiteEntry[] {
  if (term.length < 2) {
    return [];
  }
  return data.sites
    .map((entry) => ({ entry, score: domainRank(entry.d, term) }))
    .filter((match) => match.score >= 0)
    .sort((a, b) => a.score - b.score || a.entry.d.length - b.entry.d.length || a.entry.d.localeCompare(b.entry.d))
    .slice(0, limit)
    .map((match) => match.entry);
}

const companyWords = /\b(?:inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|lp|llp|pc|pllc|na|n\.a|the)\b/g;

export function companyKey(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(companyWords, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function searchNotices(data: BreachNotices, term: string, limit = 10): BreachNotice[] {
  const domainLabel = term.includes(".") ? term.split(".").slice(0, -1).join(" ") : term;
  const key = companyKey(domainLabel);
  if (key.length < 3) {
    return [];
  }
  return data.notices
    .map((notice) => {
      const name = companyKey(notice.n);
      const score = name === key ? 0 : name.startsWith(`${key} `) ? 1 : ` ${name} `.includes(` ${key} `) ? 2 : -1;
      return { notice, score };
    })
    .filter((match) => match.score >= 0)
    .sort((a, b) => a.score - b.score || b.notice.r.localeCompare(a.notice.r))
    .slice(0, limit)
    .map((match) => match.notice);
}
