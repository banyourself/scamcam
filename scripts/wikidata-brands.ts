import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { getDomain } from "tldts";
import { brands, type Brand } from "../src/engine/brands.ts";

export const sparqlEndpoint = "https://query.wikidata.org/sparql";
export const userAgent = "ScamCamBrandCheck/1.0 (https://scamcam.kevinle.tech; kevin@kevinle.tech) Node.js";
const pauseMs = 1500;
const maxAttempts = 3;
const itemPattern = /^Q[1-9]\d{0,11}$/;

export const wikidataItems: Record<string, string[]> = {
  steam: ["Q337535", "Q193559", "Q111165107", "Q771541"],
  discord: ["Q22907849"],
  roblox: ["Q692989", "Q67186598"],
  minecraft: ["Q49740", "Q1129295"],
  microsoft: ["Q2283", "Q132020"],
  epic: ["Q739711", "Q349375"],
  riot: ["Q1060165", "Q223341", "Q86919275"],
  twitch: ["Q4555537"],
  blizzard: ["Q178824", "Q725130"],
  playstation: ["Q18594", "Q719629"],
  rockstar: ["Q94912"],
  nintendo: ["Q8093"],
  faceit: ["Q30634181"],
};

export interface WebsiteRow {
  item: string;
  label: string | null;
  website: string | null;
}

export interface BrandReport {
  id: string;
  name: string;
  items: { id: string; label: string | null; websites: string[] }[];
  confirmed: string[];
  onlyOnWikidata: { domain: string; website: string; item: string }[];
  onlyInList: string[];
}

export function sparqlFor(items: string[]): string {
  if (items.length === 0 || items.some((item) => !itemPattern.test(item))) {
    throw new Error(`not a list of Wikidata item IDs: ${items.join(", ")}`);
  }
  return [
    "SELECT ?item ?label ?website WHERE {",
    `  VALUES ?item { ${items.map((item) => `wd:${item}`).join(" ")} }`,
    '  OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) IN ("en", "mul")) }',
    "  OPTIONAL { ?item wdt:P856 ?website }",
    "}",
  ].join("\n");
}

function text(value: unknown): string | null {
  const field = value as { value?: unknown } | undefined;
  return typeof field?.value === "string" ? field.value : null;
}

export function rowsFrom(body: unknown): WebsiteRow[] {
  const bindings = (body as { results?: { bindings?: unknown } } | null)?.results?.bindings;
  if (!Array.isArray(bindings)) {
    throw new Error("the answer is not a SPARQL result");
  }
  return bindings.flatMap((binding: Record<string, unknown>) => {
    const item = text(binding.item)?.split("/").at(-1) ?? "";
    return itemPattern.test(item) ? [{ item, label: text(binding.label), website: text(binding.website) }] : [];
  });
}

export function registrableDomain(website: string): string | null {
  try {
    const url = new URL(website);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    const host = url.hostname.toLowerCase();
    return getDomain(host) ?? host;
  } catch {
    return null;
  }
}

export function compareBrand(brand: Brand, rows: WebsiteRow[]): BrandReport {
  const items = new Map<string, { id: string; label: string | null; websites: string[] }>();
  for (const row of rows) {
    const entry = items.get(row.item) ?? { id: row.item, label: null, websites: [] };
    entry.label ??= row.label;
    if (row.website && !entry.websites.includes(row.website)) {
      entry.websites.push(row.website);
    }
    items.set(row.item, entry);
  }
  const official = new Set(brand.officialDomains);
  const seen = new Map<string, { domain: string; website: string; item: string }>();
  for (const entry of items.values()) {
    for (const website of entry.websites) {
      const domain = registrableDomain(website);
      if (domain && !seen.has(domain)) {
        seen.set(domain, { domain, website, item: entry.id });
      }
    }
  }
  return {
    id: brand.id,
    name: brand.name,
    items: [...items.values()],
    confirmed: brand.officialDomains.filter((domain) => seen.has(domain)),
    onlyOnWikidata: [...seen.values()].filter((site) => !official.has(site.domain)),
    onlyInList: brand.officialDomains.filter((domain) => !seen.has(domain)),
  };
}

export async function askWikidata(items: string[], fetcher: typeof fetch = fetch, wait: (ms: number) => Promise<unknown> = sleep): Promise<WebsiteRow[]> {
  const url = `${sparqlEndpoint}?${new URLSearchParams({ query: sparqlFor(items), format: "json" }).toString()}`;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetcher(url, { headers: { "User-Agent": userAgent, Accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(30_000) });
    if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
      await response.body?.cancel();
      const seconds = Number(response.headers.get("retry-after"));
      await wait((Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) : 5 * attempt) * 1000);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Wikidata answered ${response.status}`);
    }
    return rowsFrom(await response.json());
  }
}

export function formatReport(reports: BrandReport[], failures: { id: string; reason: string }[]): string {
  const lines: string[] = ["Official websites on Wikidata (P856) compared with src/engine/brands.ts", ""];
  for (const report of reports) {
    lines.push(`${report.name} (${report.id})`);
    for (const item of report.items) {
      lines.push(`  ${item.id} ${item.label ?? "(no English label)"}: ${item.websites.join(", ") || "no official website"}`);
    }
    lines.push(`  In both: ${report.confirmed.join(", ") || "none"}`);
    for (const site of report.onlyOnWikidata) {
      lines.push(`  Only on Wikidata, review before adding: ${site.domain} (${site.website}, ${site.item})`);
    }
    if (report.onlyInList.length > 0) {
      lines.push(`  Only in the brand list: ${report.onlyInList.join(", ")}`);
    }
    lines.push("");
  }
  for (const failure of failures) {
    lines.push(`Not checked: ${failure.id} (${failure.reason})`);
  }
  const differences = reports.reduce((total, report) => total + report.onlyOnWikidata.length, 0);
  const brandCount = `${reports.length} brand${reports.length === 1 ? "" : "s"}`;
  const domainCount = `${differences} Wikidata domain${differences === 1 ? "" : "s"}`;
  lines.push(`${brandCount} checked, ${domainCount} not in the brand list. Nothing was changed; review by hand. Wikidata data is CC0.`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { brand: { type: "string" }, json: { type: "boolean", default: false } } });
  const selected = values.brand ? brands.filter((brand) => brand.id === values.brand) : brands;
  if (selected.length === 0) {
    throw new Error(`no brand with the ID ${values.brand}`);
  }
  const reports: BrandReport[] = [];
  const failures: { id: string; reason: string }[] = [];
  for (const [index, brand] of selected.entries()) {
    const items = wikidataItems[brand.id];
    if (!items) {
      failures.push({ id: brand.id, reason: "no Wikidata items listed in scripts/wikidata-brands.ts" });
      continue;
    }
    if (index > 0) {
      await sleep(pauseMs);
    }
    try {
      reports.push(compareBrand(brand, await askWikidata(items)));
    } catch (error) {
      failures.push({ id: brand.id, reason: error instanceof Error ? error.message : "unknown error" });
    }
  }
  console.log(values.json ? JSON.stringify({ reports, failures }, null, 2) : formatReport(reports, failures));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
