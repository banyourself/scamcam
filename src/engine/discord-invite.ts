import { z } from "zod";
import { staffClaimIn } from "./brands";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";

export const discordInviteEndpoint = "https://discord.com/api/v10/invites/";
export const discordInviteDocs = "https://discord.com/developers/docs/resources/invite";
export const discordSource = "discord";
const cacheSeconds = 60 * 60;
const maxResponseBytes = 64 * 1024;
const discordEpochMs = 1420070400000n;
const codePattern = /^[A-Za-z0-9-]{2,32}$/;

const InviteSchema = z.object({
  code: z.string().max(64),
  approximate_member_count: z.number().int().nonnegative().optional(),
  guild: z
    .object({
      id: z.string().regex(/^\d{5,25}$/),
      name: z.string().max(200),
      features: z.array(z.string().max(64)).max(200).optional(),
    })
    .optional(),
});

const AnswerSchema = z.union([
  z.object({
    status: z.literal("ok"),
    createdAt: z.string().nullable(),
    verified: z.boolean(),
    partnered: z.boolean(),
    members: z.number().nullable(),
    claimsBrand: z.string().nullable(),
  }),
  z.object({ status: z.literal("missing") }),
]);

export type DiscordInviteAnswer = z.infer<typeof AnswerSchema>;
export type DiscordInviteResult = DiscordInviteAnswer | { status: "unavailable" };

export interface DiscordInviteOptions {
  fetcher: typeof fetch;
  lookups: Lookups;
}

function isAnswer(value: unknown): value is DiscordInviteAnswer {
  return AnswerSchema.safeParse(value).success;
}

export function serverCreatedAt(id: string): string | null {
  try {
    const milliseconds = Number((BigInt(id) >> 22n) + discordEpochMs);
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
  } catch {
    return null;
  }
}

export function inviteAnswerFrom(body: unknown): DiscordInviteAnswer | null {
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return null;
  }
  const guild = parsed.data.guild;
  const features = new Set(guild?.features ?? []);
  return {
    status: "ok",
    createdAt: guild ? serverCreatedAt(guild.id) : null,
    verified: features.has("VERIFIED"),
    partnered: features.has("PARTNERED"),
    members: parsed.data.approximate_member_count ?? null,
    claimsBrand: guild ? (staffClaimIn(guild.name)?.id ?? null) : null,
  };
}

async function queryInvite(code: string, fetcher: typeof fetch): Promise<DiscordInviteAnswer | null> {
  const timer = deadline(3000);
  try {
    const response = await fetcher(`${discordInviteEndpoint}${encodeURIComponent(code)}?with_counts=true`, {
      headers: { Accept: "application/json", "User-Agent": "ScamCam (https://scamcam.kevinle.tech)" },
      signal: timer.signal,
    });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "missing" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return inviteAnswerFrom(await readLimitedJson(response, maxResponseBytes));
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export async function lookupDiscordInvite(code: string, options: DiscordInviteOptions): Promise<DiscordInviteResult> {
  if (!codePattern.test(code)) {
    return { status: "unavailable" };
  }
  const { lookups } = options;
  const key = await cacheKey("discord-invite", code);
  const hit = await readCached(lookups, key, isAnswer);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<DiscordInviteResult> => {
    if (!sourceIsOpen(lookups, discordSource)) {
      return { status: "unavailable" };
    }
    const answer = await queryInvite(code, options.fetcher);
    recordOutcome(lookups, discordSource, answer !== null);
    if (!answer) {
      return { status: "unavailable" };
    }
    await writeCached(lookups, key, answer, cacheSeconds);
    return answer;
  });
}
