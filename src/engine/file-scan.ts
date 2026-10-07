import { describeFile, type FileCheckRequest } from "../shared/file-check";
import type { Evidence, RiskLevel, ScanReport, UncheckedSource } from "../shared/report";
import { caseNumber } from "./case-number";
import { fileSignals, runnableKinds } from "./file-signals";
import { modrinthHome, modrinthName, type ModCheck, type PackCheck } from "./modrinth";
import { strengthPoints, type Signal } from "./signals";

export type HashCheck =
  | { status: "listed"; source: string; sourceUrl?: string; title: string; detail: string }
  | { status: "flagged"; source: string; sourceUrl?: string; title: string; detail: string }
  | { status: "known_good"; source: string; sourceUrl?: string; title: string; detail: string }
  | { status: "clean"; source: string }
  | { status: "unavailable" | "over_budget" | "not_configured"; source: string };

const disguises = ["file-extension_mismatch", "file-double_extension", "file-padded_name", "file-direction_trick"];
const ambiguousCapabilities = new Set(["file-jar_session_token", "file-jar_reads_accounts", "file-jar_hidden_download", "file-jar_has_program"]);
const stolenLogins = ["jar_steals_logins", "jar_sends_to_chat", "jar_session_token", "jar_reads_accounts"];
const settledDays = 14;
const malwareOnly = new Set(["jar_steals_logins", "jar_sends_to_chat", "jar_runs_downloaded_code", "jar_hides_from_analysis", "jar_runs_commands"]);
const reviewWords: Record<string, string> = {
  processing: "still waiting for review",
  withheld: "held back by its moderators",
  rejected: "rejected by its moderators",
};

function releaseDays(mod: ModCheck | null | undefined, now: Date): number | null {
  if (mod?.status !== "published" || !mod.publishedAt) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - Date.parse(mod.publishedAt)) / 86_400_000));
}

function settledRelease(mod: ModCheck | null | undefined, now: Date): boolean {
  const days = releaseDays(mod, now);
  return mod?.status === "published" && mod.reviewed && days !== null && days >= settledDays;
}

export interface MinecraftChecks {
  mod?: ModCheck | null;
  pack?: PackCheck | null;
}

function minecraftSignals(checks: MinecraftChecks, now: Date): { signals: Signal[]; unchecked: UncheckedSource[] } {
  const base = { source: modrinthName };
  const signals: Signal[] = [];
  const unchecked: UncheckedSource[] = [];
  const mod = checks.mod;
  if (mod?.status === "published") {
    signals.push({
      ...base,
      id: "modrinth-published",
      sourceUrl: mod.projectUrl,
      direction: "context",
      strength: "weak",
      title: `Modrinth has this exact file: ${mod.title} ${mod.version}`,
      detail: `Its fingerprint matches a file Modrinth publishes for this project${mod.publishedAt ? `, released on ${new Date(mod.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}` : ""}. Modrinth reviews new projects and scans uploads, but real mod pages have been hacked before, so this alone does not prove the file is safe.`,
    });
    const days = releaseDays(mod, now);
    if (!mod.reviewed) {
      signals.push({
        ...base,
        id: "modrinth-unreviewed",
        sourceUrl: mod.projectUrl,
        direction: "context",
        strength: "weak",
        title: "This project has not passed Modrinth's review",
        detail: `Modrinth lists it as ${reviewWords[mod.projectStatus ?? ""] ?? "not public"}, so ScamCam does not count its listing in this file's favor.`,
      });
    } else if (days === null || days < settledDays) {
      signals.push({
        ...base,
        id: "modrinth-new-release",
        sourceUrl: mod.projectUrl,
        direction: "context",
        strength: "weak",
        title: days === null ? "Modrinth does not say when this release came out" : `Modrinth published this release ${days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`}`,
        detail: "When a mod developer's account is hacked, the attacker uploads malware as a new release, which is how fractureiser spread in 2023, and a bad release can stay up for days before it is found. ScamCam counts Modrinth's listing only for releases that have been public for two weeks.",
      });
    }
  } else if (mod?.status === "impostor") {
    signals.push({
      ...base,
      id: "modrinth-impostor",
      sourceUrl: mod.projectUrl,
      direction: "raises",
      strength: "moderate",
      title: `Says it is ${mod.title}, but it is not a file Modrinth has`,
      detail: `The mod inside calls itself "${mod.modId}", which is ${mod.title} on Modrinth (${mod.downloads.toLocaleString("en-US")} downloads), but this exact file is not one of its releases there. Fake copies of popular mods are a common way to spread account stealers. It may also be an official build from another site, so get ${mod.title} from its own Modrinth or CurseForge page.`,
    });
  } else if (mod?.status === "not_published") {
    signals.push({
      ...base,
      id: "modrinth-unknown",
      sourceUrl: modrinthHome,
      direction: "context",
      strength: "weak",
      title: "Modrinth has no record of this exact file",
      detail: "Mods passed around in chats or on download sites are a common way account stealers spread. Mods from Modrinth or CurseForge are much safer.",
    });
  } else if (mod?.status === "unavailable") {
    unchecked.push({ name: modrinthName, reason: "unavailable" });
  }
  const pack = checks.pack;
  if (pack?.status === "checked" && pack.total > 0) {
    signals.push(
      pack.missing > 0
        ? {
            ...base,
            id: "modrinth-pack-missing",
            sourceUrl: modrinthHome,
            direction: "raises",
            strength: "moderate",
            title: `${pack.missing} of ${pack.total} mods it carries or gets from elsewhere are not on Modrinth`,
            detail: "Some packs include mods from other sites for honest reasons, but a mod slipped into a pack is also a way to spread malware. ScamCam looked at the code of the mods carried inside on your device.",
          }
        : {
            ...base,
            id: "modrinth-pack-known",
            sourceUrl: modrinthHome,
            direction: "context",
            strength: "weak",
            title: "Modrinth has every mod this pack carries or gets from elsewhere",
            detail: `Each of these ${pack.total} files matches one published on Modrinth.`,
          },
    );
  } else if (pack?.status === "unavailable") {
    unchecked.push({ name: modrinthName, reason: "unavailable" });
  }
  return { signals, unchecked };
}

function hashSignals(checks: HashCheck[]): Signal[] {
  const signals: Signal[] = [];
  for (const check of checks) {
    if (check.status === "listed") {
      signals.push({
        id: `hash-listed-${check.source}`,
        source: check.source,
        ...(check.sourceUrl ? { sourceUrl: check.sourceUrl } : {}),
        direction: "raises",
        strength: "critical",
        confirms: true,
        title: check.title,
        detail: check.detail,
      });
    } else if (check.status === "flagged") {
      signals.push({
        id: `hash-flagged-${check.source}`,
        source: check.source,
        ...(check.sourceUrl ? { sourceUrl: check.sourceUrl } : {}),
        direction: "raises",
        strength: "strong",
        title: check.title,
        detail: check.detail,
      });
    } else if (check.status === "known_good") {
      signals.push({
        id: `hash-known-${check.source}`,
        source: check.source,
        ...(check.sourceUrl ? { sourceUrl: check.sourceUrl } : {}),
        direction: "lowers",
        strength: "moderate",
        title: check.title,
        detail: check.detail,
      });
    }
  }
  return signals;
}

function recommendationsFor(level: RiskLevel, request: FileCheckRequest, runnable: boolean, mod: ModCheck | null | undefined): string[] {
  const tips: string[] = [];
  if (level === "confirmed_malicious" || level === "high_risk" || level === "suspicious") {
    tips.push("Do not open or run this file. Delete it.");
    tips.push("If you already opened it, disconnect from the internet, change your passwords from another device, and scan your computer with Windows Security or Malwarebytes.");
    if (request.findings.some((finding) => stolenLogins.includes(finding))) {
      tips.push("If you already played with it, change your Microsoft and Discord passwords from another device and sign out of your other sessions, which ends stolen logins.");
    }
  }
  if (mod?.status === "impostor") {
    tips.push(`Get ${mod.title} from its own Modrinth or CurseForge page, not from a file someone sent.`);
  }
  if (request.findings.includes("office_macros")) {
    tips.push("Never press Enable Content or Enable Editing on a document someone sent you.");
  }
  if (request.findings.includes("archive_encrypted")) {
    tips.push("Be careful with password-protected archives: virus scanners cannot see inside them.");
  }
  if (runnable || request.findings.includes("minecraft_mod") || request.kind === "minecraft_modpack") {
    tips.push("Get games, mods, and tools only from official stores such as Steam, the Epic Games Store, CurseForge, or Modrinth.");
  }
  if (level === "unknown" || level === "no_known_threat") {
    tips.push("If you did not expect this file, ask the sender through another app before opening it.");
  }
  if (!request.sha256) {
    tips.push("To check a large file against malware lists, upload it to your antivirus or a scanning service you trust.");
  }
  return [...new Set(tips)].slice(0, 6);
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

export function fileReport(request: FileCheckRequest, checks: HashCheck[], now = new Date(), minecraft: MinecraftChecks = {}): ScanReport {
  const checkedAt = now.toISOString();
  const settled = settledRelease(minecraft.mod, now) && !request.findings.some((finding) => malwareOnly.has(finding));
  const modrinth = minecraftSignals(minecraft, now);
  const ownSignals = fileSignals(request).map((signal) =>
    settled && ambiguousCapabilities.has(signal.id)
      ? { ...signal, direction: "context" as const, detail: `${signal.detail} Modrinth has published this exact file for at least two weeks, so an honest reason is likely.` }
      : settled && signal.id === "file-kind-java_archive"
        ? { ...signal, direction: "context" as const, detail: `${signal.detail} Modrinth has published this exact file for at least two weeks, so this counts as background.` }
        : signal,
  );
  const signals = [...hashSignals(checks), ...modrinth.signals, ...ownSignals];
  const raises = signals.filter((signal) => signal.direction === "raises");
  const ambiguous = raises.filter((signal) => ambiguousCapabilities.has(signal.id)).map((signal) => strengthPoints[signal.strength]);
  const score = raises.filter((signal) => !ambiguousCapabilities.has(signal.id)).reduce((total, signal) => total + strengthPoints[signal.strength], 0) + Math.max(0, ...ambiguous);
  const runnable = runnableKinds.includes(request.kind);
  const knownGood = checks.some((check) => check.status === "known_good");
  const hashChecked = checks.some((check) => check.status !== "unavailable" && check.status !== "over_budget" && check.status !== "not_configured");
  const disguised = raises.some((signal) => disguises.includes(signal.id));

  let level: RiskLevel;
  let confidence: ScanReport["confidence"];
  let summary: string;
  if (raises.some((signal) => signal.confirms)) {
    level = "confirmed_malicious";
    confidence = "high";
    summary = "A malware database lists this exact file.";
  } else if (score >= 6) {
    level = "high_risk";
    confidence = knownGood ? "low" : "medium";
    summary = disguised ? "This file is disguised as something it is not." : "Several warning signs point to a harmful file.";
  } else if (score >= 3) {
    level = "suspicious";
    confidence = "low";
    summary = runnable ? "This file can run code on your computer, and nothing shows that it is safe." : "There are warning signs in this file.";
  } else if (score >= 2) {
    level = "unknown";
    confidence = "low";
    summary = "There are some warning signs, but not enough to call this file harmful.";
  } else if (settled && hashChecked) {
    level = "no_known_threat";
    confidence = "medium";
    summary = "Modrinth has published this exact file for at least two weeks, and nothing in it points to malware.";
  } else if (knownGood) {
    level = "no_known_threat";
    confidence = "medium";
    summary = "This exact file is in a library of known software, and nothing points to malware.";
  } else if (hashChecked) {
    level = "no_known_threat";
    confidence = "medium";
    summary = score > 0 ? "No malware list knows this file, and ScamCam found only a minor warning sign." : "No warning signs were found, and no malware list knows this file.";
  } else {
    level = "unknown";
    confidence = "low";
    summary = "ScamCam could not check this file against malware lists.";
  }

  const order = (signal: Signal) => (signal.direction === "raises" ? -strengthPoints[signal.strength] : signal.direction === "lowers" ? 20 : 10);
  const general: Signal[] = hashChecked && !raises.some((signal) => signal.confirms) && !knownGood
    ? [{ id: "hash-unknown", source: checks.find((check) => check.status === "clean")?.source ?? "Malware lists", direction: "context", strength: "weak", title: "No malware list has this exact file on record", detail: "New or slightly changed malware is not in any list yet, so this does not prove the file is safe." }]
    : [];
  const notChecked: UncheckedSource[] = checks.flatMap((check) =>
    check.status === "unavailable" || check.status === "over_budget" || check.status === "not_configured" ? [{ name: check.source, reason: check.status }] : [],
  );
  if (!request.sha256) {
    notChecked.push({ name: "Malware lists", reason: "skipped" });
  }
  notChecked.push(...modrinth.unchecked);

  return {
    caseNumber: caseNumber(now),
    createdAt: checkedAt,
    subject: { kind: "file", display: describeFile(request), ...(request.sha256 ? { fingerprint: request.sha256 } : {}) },
    level,
    confidence,
    summary,
    evidence: [...signals, ...general].sort((a, b) => order(a) - order(b)).slice(0, 14).map((signal) => toEvidence(signal, checkedAt)),
    notChecked: [...new Map(notChecked.map((entry) => [entry.name, entry])).values()],
    recommendations: recommendationsFor(level, request, runnable, minecraft.mod),
    usesGoogleSafeBrowsing: false,
  };
}
