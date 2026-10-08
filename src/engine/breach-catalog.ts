import { z } from "zod";
import type { BreachCatalog, BreachEntry, BreachNote } from "../shared/api";
import { notABreachOfTheSite } from "../shared/breaches";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";
import { scamcamUserAgent } from "./pwned-passwords";

export const hibpBreachesEndpoint = "https://haveibeenpwned.com/api/v3/breaches";
export const breachCatalogFreshSeconds = 12 * 60 * 60;
export const breachCatalogUsableDays = 7;
export const minimumBreaches = 100;
const maxCatalogBytes = 8 * 1024 * 1024;
const maxBreaches = 20_000;
const datePattern = /^\d{4}-\d{2}-\d{2}/;

const RawBreachSchema = z.object({
  Name: z.string().min(1).max(100),
  Title: z.string().min(1).max(200),
  Domain: z.string().max(253).nullable().optional(),
  BreachDate: z.string().regex(datePattern),
  AddedDate: z.string().regex(datePattern),
  PwnCount: z.number().int().nonnegative(),
  DataClasses: z.array(z.string().min(1).max(100)).max(200),
  IsVerified: z.boolean(),
  IsFabricated: z.boolean().optional(),
  IsSensitive: z.boolean().optional(),
  IsRetired: z.boolean().optional(),
  IsSpamList: z.boolean().optional(),
  IsMalware: z.boolean().optional(),
  IsStealerLog: z.boolean().optional(),
});

type RawBreach = z.infer<typeof RawBreachSchema>;

function notesOf(raw: RawBreach): BreachNote[] {
  const notes: BreachNote[] = [];
  const add = (flag: boolean | undefined, note: BreachNote) => {
    if (flag) {
      notes.push(note);
    }
  };
  add(!raw.IsVerified, "unverified");
  add(raw.IsFabricated, "fabricated");
  add(raw.IsSensitive, "sensitive");
  add(raw.IsSpamList, "spam_list");
  add(raw.IsMalware, "malware");
  add(raw.IsStealerLog, "stealer_log");
  add(raw.IsRetired, "retired");
  return notes;
}

export function compactCatalog(raw: unknown, fetchedAt: Date): BreachCatalog | null {
  if (!Array.isArray(raw) || raw.length > maxBreaches) {
    return null;
  }
  const parsed = raw.flatMap((item) => {
    const result = RawBreachSchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
  if (parsed.length < minimumBreaches) {
    return null;
  }
  const dataClasses = [...new Set(parsed.flatMap((breach) => breach.DataClasses))].sort();
  const classIndex = new Map(dataClasses.map((name, index) => [name, index]));
  const breaches: BreachEntry[] = parsed.map((breach) => ({
    name: breach.Name,
    title: breach.Title,
    domain: (breach.Domain ?? "").trim().toLowerCase(),
    breachDate: breach.BreachDate.slice(0, 10),
    addedDate: breach.AddedDate.slice(0, 10),
    accounts: breach.PwnCount,
    classes: [...new Set(breach.DataClasses.map((name) => classIndex.get(name)!))],
    notes: notesOf(breach),
  }));
  return { fetchedAt: fetchedAt.toISOString(), dataClasses, breaches };
}

export async function fetchBreachCatalog(fetcher: typeof fetch, now: Date = new Date()): Promise<BreachCatalog | null> {
  const timer = deadline(8000);
  try {
    const response = await fetcher(hibpBreachesEndpoint, {
      headers: { Accept: "application/json", "User-Agent": scamcamUserAgent },
      signal: timer.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return compactCatalog(await readLimitedJson(response, maxCatalogBytes), now);
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export function catalogAgeSeconds(catalog: BreachCatalog, now: number): number {
  const fetched = Date.parse(catalog.fetchedAt);
  return Number.isFinite(fetched) ? (now - fetched) / 1000 : Number.POSITIVE_INFINITY;
}

export function catalogIsUsable(catalog: BreachCatalog, now: number): boolean {
  return catalogAgeSeconds(catalog, now) <= breachCatalogUsableDays * 24 * 60 * 60;
}

export type BreachIndex = ReadonlyMap<string, BreachEntry[]>;

export function breachIndex(catalog: BreachCatalog): BreachIndex {
  const index = new Map<string, BreachEntry[]>();
  for (const entry of catalog.breaches) {
    if (entry.domain === "" || entry.notes.some((note) => notABreachOfTheSite.has(note))) {
      continue;
    }
    index.set(entry.domain, [...(index.get(entry.domain) ?? []), entry]);
  }
  for (const entries of index.values()) {
    entries.sort((a, b) => b.breachDate.localeCompare(a.breachDate));
  }
  return index;
}
