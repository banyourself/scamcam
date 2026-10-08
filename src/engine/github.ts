import { z } from "zod";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";
import { scamcamUserAgent } from "./pwned-passwords";
import type { GithubRef } from "./url-analysis";

export const githubApiBase = "https://api.github.com/";
export const githubApiVersion = "2026-03-10";
export const githubDocs = "https://docs.github.com/en/rest/repos/repos#get-a-repository";
export const githubSource = "github";
export const maxGithubLinks = 1;
const cacheSeconds = 60 * 60;
const maxResponseBytes = 256 * 1024;

const OwnerSchema = z.object({
  login: z.string().max(64),
  type: z.string().max(32),
  created_at: z.iso.datetime(),
});

const RepoSchema = z.object({
  created_at: z.iso.datetime(),
  stargazers_count: z.number().int().nonnegative(),
  forks_count: z.number().int().nonnegative(),
  archived: z.boolean(),
  fork: z.boolean(),
  owner: z.object({ login: z.string().max(64), type: z.string().max(32) }),
});

const BlockSchema = z.object({ block: z.object({ reason: z.string().max(64) }) });

const OwnerKindSchema = z.enum(["user", "organization"]);

const AnswerSchema = z.union([
  z.object({
    status: z.literal("repo"),
    createdAt: z.string(),
    ownerCreatedAt: z.string().nullable(),
    ownerKind: OwnerKindSchema,
    stars: z.number().int().nonnegative(),
    forks: z.number().int().nonnegative(),
    archived: z.boolean(),
    fork: z.boolean(),
  }),
  z.object({ status: z.literal("owner"), createdAt: z.string(), ownerKind: OwnerKindSchema }),
  z.object({ status: z.literal("repo_missing"), ownerExists: z.boolean() }),
  z.object({ status: z.literal("repo_blocked") }),
  z.object({ status: z.literal("owner_missing") }),
]);

export type GithubAnswer = z.infer<typeof AnswerSchema>;
export type GithubResult = GithubAnswer | { status: "not_configured" } | { status: "unavailable" };

export interface GithubOptions {
  token?: string | undefined;
  fetcher: typeof fetch;
  lookups: Lookups;
}

interface Reply {
  status: number;
  body: unknown;
}

function isAnswer(value: unknown): value is GithubAnswer {
  return AnswerSchema.safeParse(value).success;
}

function kindOf(type: string): z.infer<typeof OwnerKindSchema> {
  return type.toLowerCase() === "organization" ? "organization" : "user";
}

async function ask(path: string, token: string, fetcher: typeof fetch): Promise<Reply | null> {
  const timer = deadline(3000);
  try {
    const response = await fetcher(`${githubApiBase}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": githubApiVersion,
        "User-Agent": scamcamUserAgent,
        Authorization: `Bearer ${token}`,
      },
      signal: timer.signal,
    });
    if (response.status === 200 || response.status === 403 || response.status === 451) {
      const body = await readLimitedJson(response, maxResponseBytes).catch(() => null);
      return { status: response.status, body };
    }
    await response.body?.cancel().catch(() => undefined);
    return { status: response.status, body: null };
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

export function answerFrom(ref: GithubRef, repo: Reply | null, owner: Reply | null): GithubAnswer | null {
  if (!owner || (owner.status !== 200 && owner.status !== 404)) {
    return null;
  }
  const ownerRecord = owner.status === 200 ? OwnerSchema.safeParse(owner.body) : null;
  if (ownerRecord && !ownerRecord.success) {
    return null;
  }
  const account = ownerRecord?.data ?? null;
  if (!ref.repo) {
    return account ? { status: "owner", createdAt: account.created_at, ownerKind: kindOf(account.type) } : { status: "owner_missing" };
  }
  if (!repo) {
    return null;
  }
  if (repo.status === 451 || (repo.status === 403 && BlockSchema.safeParse(repo.body).success)) {
    return { status: "repo_blocked" };
  }
  if (repo.status === 404) {
    return { status: "repo_missing", ownerExists: account !== null };
  }
  const record = repo.status === 200 ? RepoSchema.safeParse(repo.body) : null;
  if (!record?.success) {
    return null;
  }
  const sameOwner = account !== null && account.login.toLowerCase() === record.data.owner.login.toLowerCase();
  return {
    status: "repo",
    createdAt: record.data.created_at,
    ownerCreatedAt: sameOwner ? account.created_at : null,
    ownerKind: kindOf(record.data.owner.type),
    stars: record.data.stargazers_count,
    forks: record.data.forks_count,
    archived: record.data.archived,
    fork: record.data.fork,
  };
}

export async function lookupGithub(ref: GithubRef, options: GithubOptions): Promise<GithubResult> {
  const token = options.token;
  if (!token) {
    return { status: "not_configured" };
  }
  const { lookups } = options;
  const key = await cacheKey("github", `${ref.owner.toLowerCase()}/${(ref.repo ?? "").toLowerCase()}`);
  const hit = await readCached(lookups, key, isAnswer);
  if (hit) {
    return hit;
  }
  return sharedLoad(lookups, key, async (): Promise<GithubResult> => {
    if (!sourceIsOpen(lookups, githubSource)) {
      return { status: "unavailable" };
    }
    const owner = encodeURIComponent(ref.owner);
    const [repo, account] = await Promise.all([
      ref.repo ? ask(`repos/${owner}/${encodeURIComponent(ref.repo)}`, token, options.fetcher) : Promise.resolve(null),
      ask(`users/${owner}`, token, options.fetcher),
    ]);
    const answer = answerFrom(ref, repo, account);
    recordOutcome(lookups, githubSource, answer !== null);
    if (!answer) {
      return { status: "unavailable" };
    }
    await writeCached(lookups, key, answer, cacheSeconds);
    return answer;
  });
}
