import { describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { fileReport, type HashCheck } from "../../src/engine/file-scan";
import { hashSourceNames, lookupFileHashes } from "../../src/engine/hash-lookups";
import type { FileCheckRequest } from "../../src/shared/file-check";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { allowAllBudgets, fakeNetwork, type FakeNetworkOptions } from "./fake-network";

const sha256 = "a".repeat(64);
const sha1 = "b".repeat(40);
const clean: HashCheck[] = [
  { status: "clean", source: hashSourceNames.malwareBazaar },
  { status: "clean", source: hashSourceNames.hashlookup },
];

function request(overrides: Partial<FileCheckRequest> = {}): FileCheckRequest {
  return { sha256, sha1, size: 2_400_000, kind: "pdf", extension: "pdf", findings: [], ...overrides };
}

async function lookups(network: FakeNetworkOptions, key: string | null = "test-key") {
  const fake = fakeNetwork(network);
  const checks = await lookupFileHashes({ sha256, sha1 }, { fetcher: fake.fetcher, lookups: memoryLookups(), abuseChKey: key ?? undefined, takeAbuseChBudget: allowAllBudgets });
  return { checks, fake };
}

describe("file reports", () => {
  it("describes the file without its name and matches the public schema", () => {
    const report = fileReport(request(), clean);
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(report.subject).toEqual({ kind: "file", display: "PDF document (.pdf), 2.3 MB", fingerprint: sha256 });
    expect(report.level).toBe("no_known_threat");
    expect(report.confidence).toBe("medium");
    expect(report.summary).toBe("No warning signs were found, and no malware list knows this file.");
  });

  it("rates a program disguised as a picture as high risk", () => {
    const report = fileReport(request({ kind: "windows_program", extension: "exe", findings: ["double_extension"] }), clean);
    expect(report.level).toBe("high_risk");
    expect(report.summary).toBe("This file is disguised as something it is not.");
    expect(report.recommendations[0]).toBe("Do not open or run this file. Delete it.");
  });

  it("rates a plain program from a stranger as suspicious and points to official stores", () => {
    const report = fileReport(request({ kind: "windows_program", extension: "exe" }), clean);
    expect(report.level).toBe("suspicious");
    expect(report.recommendations).toContain("Get games, mods, and tools only from official stores such as Steam, the Epic Games Store, CurseForge, or Modrinth.");
  });

  it("confirms a file that a malware list has on record", () => {
    const listed: HashCheck[] = [{ status: "listed", source: hashSourceNames.malwareBazaar, title: "MalwareBazaar lists this exact file as RedLineStealer", detail: "x" }];
    const report = fileReport(request({ kind: "windows_program", extension: "exe" }), listed);
    expect(report.level).toBe("confirmed_malicious");
    expect(report.evidence[0]!.title).toBe("MalwareBazaar lists this exact file as RedLineStealer");
  });

  it("trusts known published software, and says what it could not check", () => {
    const known: HashCheck[] = [{ status: "known_good", source: hashSourceNames.hashlookup, title: "This exact file is known published software", detail: "x" }, { status: "unavailable", source: hashSourceNames.malwareBazaar }];
    const report = fileReport(request({ kind: "office_document", extension: "docx" }), known);
    expect(report.level).toBe("no_known_threat");
    expect(report.confidence).toBe("medium");
    expect(report.summary).toBe("This exact file is in a library of known software, and nothing points to malware.");
    expect(report.notChecked).toEqual([{ name: hashSourceNames.malwareBazaar, reason: "unavailable" }]);
  });

  it("does not call a file safe when it could not be fingerprinted", () => {
    const report = fileReport(request({ sha256: undefined, sha1: undefined, findings: ["too_large_to_hash"] }), []);
    expect(report.level).toBe("unknown");
    expect(report.notChecked).toContainEqual({ name: "Malware lists", reason: "skipped" });
    expect(report.subject.display).toBe("PDF document (.pdf), 2.3 MB");
  });

  it("treats a macro document and a shortcut that runs commands as dangerous", () => {
    expect(fileReport(request({ kind: "office_document", extension: "docm", findings: ["office_macros"] }), clean).level).toBe("suspicious");
    expect(fileReport(request({ kind: "windows_shortcut", extension: "lnk", findings: ["shortcut_runs_command"] }), clean).level).toBe("high_risk");
  });
});

describe("hash lookups", () => {
  it("sends each service only a fingerprint", async () => {
    const { checks, fake } = await lookups({});
    expect(checks.map((check) => check.status)).toEqual(["clean", "clean", "clean"]);
    const hosts = fake.requests.map((entry) => new URL(entry.url).hostname).sort();
    expect(hosts).toEqual(["cloudflare-dns.com", "hashlookup.circl.lu", "mb-api.abuse.ch"]);
    for (const entry of fake.requests) {
      expect(`${entry.url} ${entry.body}`).toMatch(new RegExp(`${sha256}|${sha1}`));
    }
  });

  it("reports MalwareBazaar matches with the malware family", async () => {
    const { checks } = await lookups({ malware: { [sha256]: "RedLineStealer" } });
    expect(checks[0]).toMatchObject({ status: "listed", title: "MalwareBazaar lists this exact file as RedLineStealer", sourceUrl: "https://bazaar.abuse.ch/" });
  });

  it("recognizes known published software", async () => {
    const { checks } = await lookups({ knownFiles: [sha256] });
    expect(checks[1]).toMatchObject({ status: "known_good" });
    expect((checks[1] as { detail: string }).detail).toContain("Example Game Launcher");
  });

  it("treats CIRCL's own malware tag as a listing and ignores files it barely trusts", async () => {
    const tagged = await lookups({ knownMalware: { [sha256]: "malshare.com" } });
    expect(tagged.checks[1]).toMatchObject({ status: "listed" });
    expect((tagged.checks[1] as { detail: string }).detail).toContain("(reported by malshare.com)");
    expect((await lookups({ lowTrustFiles: [sha256] })).checks[1]).toMatchObject({ status: "clean" });
  });

  it("separates broad antivirus detection from a few engines", async () => {
    expect((await lookups({ antivirus: { [sha1]: 64 } })).checks[2]).toMatchObject({ status: "listed" });
    expect((await lookups({ antivirus: { [sha1]: 6 } })).checks[2]).toMatchObject({ status: "flagged" });
  });

  it("skips MalwareBazaar without a key and reports services that are down", async () => {
    const { checks } = await lookups({ down: true }, null);
    expect(checks.map((check) => check.status)).toEqual(["not_configured", "unavailable", "unavailable"]);
  });
});
