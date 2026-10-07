import { z } from "zod";
import { sha1Pattern } from "../shared/file-check";
import { cacheKey, readCached, recordOutcome, sharedLoad, sourceIsOpen, writeCached, type Lookups } from "./cache";
import { deadline } from "./deadline";
import { readLimitedJson } from "./limited-body";

export const modrinthApi = "https://api.modrinth.com/v2/";
export const modrinthSource = "modrinth";
export const modrinthName = "Modrinth";
export const modrinthHome = "https://modrinth.com/";
export const popularDownloads = 50_000;
const userAgent = "ScamCam (https://scamcam.kevinle.tech)";
const maxResponseBytes = 512 * 1024;
const fileCacheSeconds = 60 * 60;
const missingCacheSeconds = 60 * 60;
const projectCacheSeconds = 6 * 60 * 60;
const projectIdPattern = /^[A-Za-z0-9]{8}$/;
const reviewedProjects = new Set(["approved", "archived", "unlisted"]);
const publicVersions = new Set(["listed", "archived", "unlisted"]);

const VersionSchema = z.object({
  project_id: z.string().regex(projectIdPattern),
  version_number: z.string().max(200),
  date_published: z.string().max(40).optional(),
  status: z.string().max(32).optional(),
});

const ProjectSchema = z.object({
  id: z.string().regex(projectIdPattern),
  title: z.string().max(256),
  downloads: z.number().int().nonnegative(),
  project_type: z.string().max(32),
  status: z.string().max(32),
});

const FileAnswerSchema = z.union([
  z.object({ status: z.literal("found"), projectId: z.string().regex(projectIdPattern), version: z.string().max(80), publishedAt: z.string().max(40).nullable(), listed: z.boolean() }),
  z.object({ status: z.literal("missing") }),
]);
const ProjectAnswerSchema = z.union([
  z.object({ status: z.literal("found"), id: z.string().regex(projectIdPattern), title: z.string().max(80), downloads: z.number(), type: z.string().max(32), review: z.string().max(32) }),
  z.object({ status: z.literal("missing") }),
]);

type FileAnswer = z.infer<typeof FileAnswerSchema>;
type ProjectAnswer = z.infer<typeof ProjectAnswerSchema>;
type Found<T> = Extract<T, { status: "found" }>;

export type ModCheck =
  | { status: "published"; title: string; version: string; projectUrl: string; publishedAt: string | null; reviewed: boolean; projectStatus: string | null }
  | { status: "impostor"; title: string; downloads: number; modId: string; projectUrl: string }
  | { status: "not_published" }
  | { status: "unavailable" };

export type PackCheck = { status: "checked"; total: number; missing: number } | { status: "unavailable" };

export interface ModrinthOptions {
  fetcher: typeof fetch;
  lookups: Lookups;
}

export function projectUrl(id: string): string {
  return `${modrinthHome}project/${id}`;
}

function cleanText(value: string, max: number): string {
  return value.replace(/[^\p{L}\p{N} .,:+()&'!?_-]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
}

async function request(path: string, options: ModrinthOptions, init: RequestInit = {}): Promise<{ status: number; body: unknown } | null> {
  const timer = deadline(4000);
  try {
    const response = await options.fetcher(`${modrinthApi}${path}`, {
      ...init,
      headers: { Accept: "application/json", "User-Agent": userAgent, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: timer.signal,
    });
    if (response.status === 404) {
      await response.body?.cancel().catch(() => undefined);
      return { status: 404, body: null };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    return { status: response.status, body: await readLimitedJson(response, maxResponseBytes) };
  } catch {
    return null;
  } finally {
    timer.clear();
  }
}

async function remembered<T extends { status: string }>(
  key: string,
  options: ModrinthOptions,
  isValue: (value: unknown) => value is T,
  load: () => Promise<T | null>,
  seconds: (value: T) => number,
): Promise<T | null> {
  const hit = await readCached(options.lookups, key, isValue);
  if (hit) {
    return hit;
  }
  return sharedLoad(options.lookups, key, async () => {
    if (!sourceIsOpen(options.lookups, modrinthSource)) {
      return null;
    }
    const value = await load();
    recordOutcome(options.lookups, modrinthSource, value !== null);
    if (value) {
      await writeCached(options.lookups, key, value, seconds(value));
    }
    return value;
  });
}

async function fileAnswer(sha1: string, options: ModrinthOptions): Promise<FileAnswer | null> {
  return remembered(
    await cacheKey("modrinth-file", sha1),
    options,
    (value): value is FileAnswer => FileAnswerSchema.safeParse(value).success,
    async () => {
      const result = await request(`version_file/${sha1}?algorithm=sha1`, options);
      if (!result) {
        return null;
      }
      if (result.status === 404) {
        return { status: "missing" };
      }
      const parsed = VersionSchema.safeParse(result.body);
      if (!parsed.success) {
        return null;
      }
      const published = Date.parse(parsed.data.date_published ?? "");
      return {
        status: "found",
        projectId: parsed.data.project_id,
        version: cleanText(parsed.data.version_number, 80),
        publishedAt: Number.isFinite(published) ? new Date(published).toISOString() : null,
        listed: publicVersions.has(parsed.data.status ?? "listed"),
      };
    },
    (value) => (value.status === "found" ? fileCacheSeconds : missingCacheSeconds),
  );
}

async function projectAnswer(idOrSlug: string, options: ModrinthOptions): Promise<ProjectAnswer | null> {
  return remembered(
    await cacheKey("modrinth-project", idOrSlug),
    options,
    (value): value is ProjectAnswer => ProjectAnswerSchema.safeParse(value).success,
    async () => {
      const result = await request(`project/${encodeURIComponent(idOrSlug)}`, options);
      if (!result) {
        return null;
      }
      if (result.status === 404) {
        return { status: "missing" };
      }
      const parsed = ProjectSchema.safeParse(result.body);
      return parsed.success
        ? { status: "found", id: parsed.data.id, title: cleanText(parsed.data.title, 80) || parsed.data.id, downloads: parsed.data.downloads, type: parsed.data.project_type, review: parsed.data.status }
        : null;
    },
    (value) => (value.status === "found" ? projectCacheSeconds : missingCacheSeconds),
  );
}

export async function lookupMod(file: { sha1: string; modId?: string | undefined }, options: ModrinthOptions): Promise<ModCheck> {
  if (!sha1Pattern.test(file.sha1)) {
    return { status: "unavailable" };
  }
  const published = await fileAnswer(file.sha1, options);
  if (!published) {
    return { status: "unavailable" };
  }
  if (published.status === "found") {
    const project = await projectAnswer(published.projectId, options);
    const found = project?.status === "found" ? project : null;
    return {
      status: "published",
      title: found?.title ?? "a project",
      version: published.version,
      projectUrl: projectUrl(published.projectId),
      publishedAt: published.publishedAt,
      reviewed: Boolean(found && reviewedProjects.has(found.review) && published.listed),
      projectStatus: found?.review ?? null,
    };
  }
  if (!file.modId) {
    return { status: "not_published" };
  }
  const claimed = await projectAnswer(file.modId, options);
  if (!claimed) {
    return { status: "unavailable" };
  }
  const popular = (project: ProjectAnswer): project is Found<ProjectAnswer> => project.status === "found" && project.downloads >= popularDownloads && (project.type === "mod" || project.type === "plugin");
  return popular(claimed)
    ? { status: "impostor", title: claimed.title, downloads: claimed.downloads, modId: file.modId, projectUrl: projectUrl(claimed.id) }
    : { status: "not_published" };
}

export async function lookupPackFiles(hashes: string[], options: ModrinthOptions): Promise<PackCheck> {
  const wanted = [...new Set(hashes.filter((hash) => sha1Pattern.test(hash)))];
  if (wanted.length === 0) {
    return { status: "checked", total: 0, missing: 0 };
  }
  if (!sourceIsOpen(options.lookups, modrinthSource)) {
    return { status: "unavailable" };
  }
  const result = await request("version_files", options, { method: "POST", body: JSON.stringify({ hashes: wanted, algorithm: "sha1" }) });
  const parsed = result && result.status !== 404 ? z.record(z.string(), z.unknown()).safeParse(result.body) : null;
  recordOutcome(options.lookups, modrinthSource, Boolean(parsed?.success));
  if (!parsed?.success) {
    return { status: "unavailable" };
  }
  const found = new Set(Object.keys(parsed.data).map((key) => key.toLowerCase()));
  return { status: "checked", total: wanted.length, missing: wanted.filter((hash) => !found.has(hash)).length };
}
