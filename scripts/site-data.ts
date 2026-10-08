import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { maskOf, passkeySecondStep, passkeySignIn, type BreachNotice, type BreachNotices, type SiteDataset, type SiteEntry, type SiteSecurity } from "../src/shared/site-data.ts";

export const sources = {
  twoFactor: "https://api.2fa.directory/v4/all.json",
  passkeys: "https://passkeys-api.2fa.directory/v1/all.json",
  appleRepo: "apple/password-manager-resources",
  applePath: "quirks/change-password-URLs.json",
  washington:
    "https://data.wa.gov/resource/sb4j-ca4h.json?$select=name,datesubmitted,datestart,washingtoniansaffected,databreachcause&$order=datesubmitted%20DESC&$limit=50000",
  california: "https://oag.ca.gov/privacy/databreach/list-export",
};
export const minimums = { twoFactor: 2000, passkeys: 500, changePassword: 300, washington: 1000, california: 3000 };
export const partLength = 60_000;
const userAgent = "ScamCam data build (+https://scamcam.kevinle.tech)";
const maxBytes = 30 * 1024 * 1024;
const domainPattern = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? undefined : text.slice(0, max);
}

export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 500) {
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.username === "" && url.password === "" && domainPattern.test(url.hostname) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function names(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const list = value.flatMap((item) => clean(item, 60) ?? []).slice(0, 5);
  return list.length > 0 ? list : undefined;
}

function records(value: unknown, label: string): [string, Record<string, unknown>][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object of sites`);
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([domain, entry]) => {
    const key = domain.trim().toLowerCase();
    return domainPattern.test(key) && typeof entry === "object" && entry !== null && !Array.isArray(entry) ? [[key, entry as Record<string, unknown>]] : [];
  });
}

function atLeast<T>(list: T[], minimum: number, label: string): T[] {
  if (list.length < minimum) {
    throw new Error(`${label}: expected at least ${minimum} entries, found ${list.length}`);
  }
  return list;
}

export function buildSiteSecurity(twoFactor: unknown, passkeys: unknown, changePassword: unknown, builtAt: Date): SiteSecurity {
  const sites = new Map<string, SiteEntry>();
  const entry = (domain: string) => {
    let site = sites.get(domain);
    if (!site) {
      site = { d: domain };
      sites.set(domain, site);
    }
    return site;
  };
  for (const [domain, raw] of atLeast(records(twoFactor, "2FA Directory"), minimums.twoFactor, "2FA Directory")) {
    const site = entry(domain);
    const methods = Array.isArray(raw.methods) ? raw.methods.filter((method): method is string => typeof method === "string") : [];
    site.m = maskOf(methods);
    const sw = names(raw["custom-software"]);
    const hw = names(raw["custom-hardware"]);
    const doc = safeUrl(raw.documentation);
    const rec = safeUrl(raw.recovery);
    const note = clean(raw.notes, 300);
    Object.assign(site, sw && { sw }, hw && { hw }, doc && { doc }, rec && { rec }, note && { note });
  }
  for (const [domain, raw] of atLeast(records(passkeys, "Passkeys Directory"), minimums.passkeys, "Passkeys Directory")) {
    const pk = (raw.passwordless === "allowed" ? passkeySignIn : 0) | (raw.mfa === "allowed" || raw.mfa === "required" ? passkeySecondStep : 0);
    if (pk === 0) {
      continue;
    }
    const site = entry(domain);
    const pkDoc = safeUrl(raw.documentation);
    const pkNote = clean(raw.notes, 300);
    Object.assign(site, { pk }, pkDoc && { pkDoc }, pkNote && { pkNote });
  }
  const links = atLeast(
    records(
      Object.fromEntries(Object.entries((changePassword ?? {}) as Record<string, unknown>).map(([domain, url]) => [domain, { url }])),
      "Change password URLs",
    ),
    minimums.changePassword,
    "Change password URLs",
  );
  for (const [domain, raw] of links) {
    const cp = safeUrl(raw.url);
    if (cp) {
      entry(domain).cp = cp;
    }
  }
  return { v: 1, builtAt: builtAt.toISOString(), sites: [...sites.values()].sort((a, b) => a.d.localeCompare(b.d)) };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

function usDay(text: string): string | undefined {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!match) {
    return undefined;
  }
  const day = `${match[3]}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${day}T00:00:00Z`)) ? undefined : day;
}

function isoPrefix(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined;
}

export function washingtonNotices(rows: unknown): BreachNotice[] {
  if (!Array.isArray(rows)) {
    throw new Error("Washington: not a list of rows");
  }
  const notices = rows.flatMap((raw: Record<string, unknown>): BreachNotice[] => {
    const n = clean(raw?.name, 200);
    const r = isoPrefix(raw?.datesubmitted);
    if (!n || !r) {
      return [];
    }
    const start = isoPrefix(raw.datestart);
    const affected = Number(raw.washingtoniansaffected);
    const c = clean(raw.databreachcause, 60);
    return [Object.assign({ s: "wa" as const, n, r }, start && { b: [start] }, Number.isInteger(affected) && affected >= 0 && { a: affected }, c && { c })];
  });
  return atLeast(notices, minimums.washington, "Washington");
}

export function californiaNotices(csv: string): BreachNotice[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header || !/organization name/i.test(header[0] ?? "") || !/reported date/i.test(header[2] ?? "")) {
    throw new Error("California: unexpected columns");
  }
  const notices = rows.flatMap((cells): BreachNotice[] => {
    const n = clean(cells[0], 200);
    const r = usDay(cells[2] ?? "");
    if (!n || !r) {
      return [];
    }
    const b = (cells[1] ?? "")
      .split(",")
      .flatMap((part) => usDay(part) ?? [])
      .slice(0, 4);
    return [Object.assign({ s: "ca" as const, n, r }, b.length > 0 && { b })];
  });
  return atLeast(notices, minimums.california, "California");
}

export function buildNotices(washington: BreachNotice[], california: BreachNotice[], builtAt: Date): BreachNotices {
  const notices = [...washington, ...california].sort((a, b) => b.r.localeCompare(a.r) || a.n.localeCompare(b.n));
  return { v: 1, builtAt: builtAt.toISOString(), notices };
}

export interface PackedDataset {
  dataset: SiteDataset;
  version: string;
  parts: string[];
  bytes: number;
  json: number;
}

export function pack(dataset: SiteDataset, data: SiteSecurity | BreachNotices): PackedDataset {
  const json = JSON.stringify(data);
  const gzipped = gzipSync(json, { level: 9 });
  const encoded = gzipped.toString("base64");
  const parts: string[] = [];
  for (let start = 0; start < encoded.length; start += partLength) {
    parts.push(encoded.slice(start, start + partLength));
  }
  return { dataset, version: createHash("sha256").update(gzipped).digest("hex").slice(0, 16), parts, bytes: gzipped.length, json: json.length };
}

export function sqlFor(packed: PackedDataset, builtAt: Date): string {
  if (!/^[0-9a-f]{16}$/.test(packed.version) || !packed.parts.every((part) => /^[A-Za-z0-9+/=]+$/.test(part))) {
    throw new Error("refusing to write unexpected characters");
  }
  const { dataset, version } = packed;
  const seconds = Math.floor(builtAt.getTime() / 1000);
  return [
    `DELETE FROM site_data_parts WHERE dataset = '${dataset}' AND version = '${version}';`,
    ...packed.parts.map((part, index) => `INSERT INTO site_data_parts (dataset, version, part, body) VALUES ('${dataset}', '${version}', ${index}, '${part}');`),
    `INSERT INTO site_data (dataset, version, parts, bytes, built_at) VALUES ('${dataset}', '${version}', ${packed.parts.length}, ${packed.bytes}, ${seconds}) ON CONFLICT (dataset) DO UPDATE SET version = excluded.version, parts = excluded.parts, bytes = excluded.bytes, built_at = excluded.built_at;`,
    `DELETE FROM site_data_parts WHERE dataset = '${dataset}' AND version <> '${version}';`,
  ].join("\n");
}

async function download(url: string, accept: string, headers: Record<string, string> = {}): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: accept, ...headers }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} answered ${response.status}`);
  }
  const length = Number(response.headers.get("content-length"));
  if (length > maxBytes) {
    throw new Error(`${new URL(url).hostname} sent ${length} bytes`);
  }
  const text = await response.text();
  if (text.length > maxBytes) {
    throw new Error(`${new URL(url).hostname} sent too much`);
  }
  return text;
}

async function appleCommit(): Promise<string> {
  const token = process.env.GH_TOKEN;
  const text = await download(`https://api.github.com/repos/${sources.appleRepo}/commits?path=${sources.applePath}&per_page=1`, "application/vnd.github+json", token ? { Authorization: `Bearer ${token}` } : {});
  const sha = (JSON.parse(text) as { sha?: unknown }[])[0]?.sha;
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("unexpected Apple commit id");
  }
  return sha;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string", default: "site-data" } } });
  const out = values.out!;
  mkdirSync(out, { recursive: true });
  const builtAt = new Date();
  const statements: string[] = [];
  const failures: string[] = [];
  const builders: [SiteDataset, () => Promise<SiteSecurity | BreachNotices>][] = [
    [
      "site-security",
      async () => {
        const sha = await appleCommit();
        const [twoFactor, passkeys, changePassword] = await Promise.all([
          download(sources.twoFactor, "application/json"),
          download(sources.passkeys, "application/json"),
          download(`https://raw.githubusercontent.com/${sources.appleRepo}/${sha}/${sources.applePath}`, "application/json"),
        ]);
        return buildSiteSecurity(JSON.parse(twoFactor), JSON.parse(passkeys), JSON.parse(changePassword), builtAt);
      },
    ],
    [
      "breach-notices",
      async () => {
        const [washington, california] = await Promise.all([download(sources.washington, "application/json"), download(sources.california, "text/csv")]);
        return buildNotices(washingtonNotices(JSON.parse(washington)), californiaNotices(california), builtAt);
      },
    ],
  ];
  for (const [dataset, build] of builders) {
    try {
      const data = await build();
      const packed = pack(dataset, data);
      writeFileSync(join(out, `${dataset}.json`), JSON.stringify(data));
      statements.push(sqlFor(packed, builtAt));
      const count = "sites" in data ? data.sites.length : data.notices.length;
      console.log(`${dataset}: ${count} entries, ${packed.json} bytes of JSON, ${packed.bytes} gzipped, ${packed.parts.length} parts, version ${packed.version}`);
    } catch (error) {
      failures.push(dataset);
      console.error(`${dataset} was not built: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  writeFileSync(join(out, "site-data.sql"), statements.join("\n") + (statements.length > 0 ? "\n" : ""));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
