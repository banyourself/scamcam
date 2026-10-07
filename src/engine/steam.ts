import { z } from "zod";
import { staffClaimIn } from "./brands";
import { cacheKey, readCached, recordOutcome, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";
import type { SteamRef } from "./url-analysis";

export const steamApiBase = "https://api.steampowered.com/ISteamUser/";
export const steamHomePage = "https://steamcommunity.com/dev";
export const steamSource = "steam";
export const maxSteamAccounts = 2;
const cacheSeconds = 60 * 60;
const maxResponseBytes = 64 * 1024;
const steamIdPattern = /^7656119\d{10}$/;
const vanityPattern = /^[A-Za-z0-9_-]{2,32}$/;

const VanitySchema = z.object({
  response: z.object({ success: z.number().int(), steamid: z.string().regex(steamIdPattern).optional() }),
});

const BansSchema = z.object({
  players: z
    .array(
      z.object({
        SteamId: z.string().regex(steamIdPattern),
        CommunityBanned: z.boolean(),
        NumberOfVACBans: z.number().int().nonnegative(),
        NumberOfGameBans: z.number().int().nonnegative(),
        EconomyBan: z.string().max(32),
      }),
    )
    .max(100),
});

const SummariesSchema = z.object({
  response: z.object({
    players: z
      .array(
        z.object({
          steamid: z.string().regex(steamIdPattern),
          communityvisibilitystate: z.number().int().optional(),
          personaname: z.string().max(256).optional(),
          timecreated: z.number().int().positive().optional(),
        }),
      )
      .max(100),
  }),
});

const AnswerSchema = z.union([
  z.object({
    status: z.literal("ok"),
    tradeBan: z.enum(["none", "probation", "banned"]),
    communityBanned: z.boolean(),
    gameBans: z.number().int().nonnegative(),
    createdAt: z.string().nullable(),
    claimsBrand: z.string().nullable(),
  }),
  z.object({ status: z.literal("missing") }),
]);

export type SteamAccountAnswer = z.infer<typeof AnswerSchema>;
export type SteamAccountResult = SteamAccountAnswer | { status: "unavailable" };

export interface SteamOptions {
  key: string;
  fetcher: typeof fetch;
  lookups: Lookups;
}

type Bans = z.infer<typeof BansSchema>["players"][number];
type Summary = z.infer<typeof SummariesSchema>["response"]["players"][number];

function isAnswer(value: unknown): value is SteamAccountAnswer {
  return AnswerSchema.safeParse(value).success;
}

function isValidRef(ref: SteamRef): boolean {
  return ref.kind === "id" ? steamIdPattern.test(ref.value) : vanityPattern.test(ref.value);
}

async function getJson<T>(url: string, schema: z.ZodType<T>, fetcher: typeof fetch): Promise<T | null> {
  const timer = deadline(3000);
  try {
    const response = await fetcher(url, { headers: { Accept: "application/json" }, signal: timer.signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const parsed = schema.safeParse(await readLimitedJson(response, maxResponseBytes));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

function methodUrl(method: string, key: string, query: Record<string, string>): string {
  return `${steamApiBase}${method}?${new URLSearchParams({ key, ...query }).toString()}`;
}

async function resolveVanity(vanity: string, options: SteamOptions): Promise<string | "missing" | null> {
  const body = await getJson(methodUrl("ResolveVanityURL/v1/", options.key, { vanityurl: vanity }), VanitySchema, options.fetcher);
  if (!body) {
    return null;
  }
  if (body.response.success === 1 && body.response.steamid) {
    return body.response.steamid;
  }
  return body.response.success === 42 ? "missing" : null;
}

export function accountAnswerFrom(bans: Bans | undefined, summary: Summary | undefined): SteamAccountAnswer {
  if (!bans && !summary) {
    return { status: "missing" };
  }
  const economy = bans?.EconomyBan.toLowerCase();
  const visible = summary?.communityvisibilitystate === 3;
  return {
    status: "ok",
    tradeBan: economy === "banned" ? "banned" : economy === "probation" ? "probation" : "none",
    communityBanned: bans?.CommunityBanned ?? false,
    gameBans: (bans?.NumberOfVACBans ?? 0) + (bans?.NumberOfGameBans ?? 0),
    createdAt: visible && summary?.timecreated ? new Date(summary.timecreated * 1000).toISOString() : null,
    claimsBrand: summary?.personaname ? (staffClaimIn(summary.personaname)?.id ?? null) : null,
  };
}

async function queryAccounts(ids: string[], options: SteamOptions): Promise<Map<string, SteamAccountAnswer> | null> {
  const steamids = ids.join(",");
  const [bans, summaries] = await Promise.all([
    getJson(methodUrl("GetPlayerBans/v1/", options.key, { steamids }), BansSchema, options.fetcher),
    getJson(methodUrl("GetPlayerSummaries/v2/", options.key, { steamids }), SummariesSchema, options.fetcher),
  ]);
  if (!bans || !summaries) {
    return null;
  }
  return new Map(
    ids.map((id) => [
      id,
      accountAnswerFrom(
        bans.players.find((player) => player.SteamId === id),
        summaries.response.players.find((player) => player.steamid === id),
      ),
    ]),
  );
}

export async function lookupSteamAccounts(refs: SteamRef[], options: SteamOptions): Promise<SteamAccountResult[]> {
  const { lookups } = options;
  const results: SteamAccountResult[] = refs.map(() => ({ status: "unavailable" }));
  const pending: { index: number; key: string; ref: SteamRef }[] = [];
  for (const [index, ref] of refs.slice(0, maxSteamAccounts).entries()) {
    if (!options.key || !isValidRef(ref)) {
      continue;
    }
    const key = await cacheKey("steam-account", `${ref.kind}:${ref.value.toLowerCase()}`);
    const hit = await readCached(lookups, key, isAnswer);
    if (hit) {
      results[index] = hit;
    } else {
      pending.push({ index, key, ref });
    }
  }
  if (pending.length === 0 || !sourceIsOpen(lookups, steamSource)) {
    return results;
  }
  const ids = await Promise.all(pending.map(({ ref }) => (ref.kind === "id" ? Promise.resolve(ref.value) : resolveVanity(ref.value, options))));
  const wanted = [...new Set(ids.filter((id): id is string => id !== null && id !== "missing"))];
  const accounts = wanted.length > 0 ? await queryAccounts(wanted, options) : new Map<string, SteamAccountAnswer>();
  recordOutcome(lookups, steamSource, accounts !== null && ids.every((id) => id !== null));
  for (const [position, { index, key }] of pending.entries()) {
    const id = ids[position];
    const answer: SteamAccountAnswer | undefined = id === "missing" ? { status: "missing" } : id && accounts ? accounts.get(id) : undefined;
    if (answer) {
      results[index] = answer;
      await writeCached(lookups, key, answer, cacheSeconds);
    }
  }
  return results;
}
