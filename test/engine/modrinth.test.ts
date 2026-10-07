import { describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { fileReport, type HashCheck } from "../../src/engine/file-scan";
import { hashSourceNames } from "../../src/engine/hash-lookups";
import { lookupMod, lookupPackFiles, modrinthApi } from "../../src/engine/modrinth";
import type { FileCheckRequest } from "../../src/shared/file-check";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { fakeNetwork, type FakeNetworkOptions } from "./fake-network";

const sha1 = "1".repeat(40);
const other = "2".repeat(40);
const sodium = { id: "AANobbMI", slug: "sodium", title: "Sodium", downloads: 238_449_097 };
const network: FakeNetworkOptions = { modrinthFiles: { [sha1]: { project: sodium.id, version: "0.9.3" } }, modrinthProjects: [sodium, { id: "SmallMod", slug: "tiny", title: "Tiny", downloads: 900 }] };
const clean: HashCheck[] = [{ status: "clean", source: hashSourceNames.malwareBazaar }];

function setup(options: FakeNetworkOptions = network) {
  const fake = fakeNetwork(options);
  return { fake, sources: { fetcher: fake.fetcher, lookups: memoryLookups() } };
}

function mod(overrides: Partial<FileCheckRequest> = {}): FileCheckRequest {
  return { sha256: "a".repeat(64), sha1, size: 1_900_000, kind: "java_archive", extension: "jar", findings: ["minecraft_mod"], modId: "sodium", ...overrides };
}

describe("Modrinth lookups", () => {
  it("names the project of a published file and sends only the fingerprint", async () => {
    const { fake, sources } = setup();
    expect(await lookupMod({ sha1, modId: "sodium" }, sources)).toEqual({ status: "published", title: "Sodium", version: "0.9.3", projectUrl: "https://modrinth.com/project/AANobbMI" });
    expect(fake.requests.map((request) => request.url)).toEqual([`${modrinthApi}version_file/${sha1}?algorithm=sha1`, `${modrinthApi}project/AANobbMI`]);
    expect(fake.requests[0]!.headers.get("User-Agent")).toBe("ScamCam (https://scamcam.kevinle.tech)");
  });

  it("calls an unknown file that names a popular mod an impostor", async () => {
    const { sources } = setup();
    expect(await lookupMod({ sha1: other, modId: "sodium" }, sources)).toMatchObject({ status: "impostor", title: "Sodium", modId: "sodium", downloads: sodium.downloads });
    expect(await lookupMod({ sha1: other, modId: "tiny" }, sources)).toEqual({ status: "not_published" });
    expect(await lookupMod({ sha1: other, modId: "nothing-here" }, sources)).toEqual({ status: "not_published" });
    expect(await lookupMod({ sha1: other }, sources)).toEqual({ status: "not_published" });
  });

  it("remembers answers and reports an outage as unavailable", async () => {
    const { fake, sources } = setup();
    await lookupMod({ sha1, modId: "sodium" }, sources);
    await lookupMod({ sha1, modId: "sodium" }, sources);
    expect(fake.requests).toHaveLength(2);
    const down = setup({ modrinthStatus: 503 });
    expect(await lookupMod({ sha1, modId: "sodium" }, down.sources)).toEqual({ status: "unavailable" });
    expect(await lookupPackFiles([sha1], down.sources)).toEqual({ status: "unavailable" });
    expect(await lookupMod({ sha1: "not-a-hash" }, setup().sources)).toEqual({ status: "unavailable" });
  });

  it("checks a pack's mods in one request", async () => {
    const { fake, sources } = setup();
    expect(await lookupPackFiles([sha1, other, other, "bad"], sources)).toEqual({ status: "checked", total: 2, missing: 1 });
    expect(fake.requests).toHaveLength(1);
    expect(JSON.parse(fake.requests[0]!.body)).toEqual({ hashes: [sha1, other], algorithm: "sha1" });
    expect(await lookupPackFiles([], sources)).toEqual({ status: "checked", total: 0, missing: 0 });
  });
});

describe("Minecraft file reports", () => {
  it("shows a published file as context, and treats an honest-looking capability as context too", () => {
    const report = fileReport(mod({ findings: ["minecraft_mod", "jar_session_token"] }), clean, new Date(), {
      mod: { status: "published", title: "Sodium", version: "0.9.3", projectUrl: "https://modrinth.com/project/AANobbMI" },
    });
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(report.level).toBe("unknown");
    expect(report.evidence.find((item) => item.id === "modrinth-published")).toMatchObject({ signal: "neutral", title: "Modrinth has this exact file: Sodium 0.9.3", source: { name: "Modrinth", url: "https://modrinth.com/project/AANobbMI" } });
    expect(report.evidence.find((item) => item.id === "file-jar_session_token")?.signal).toBe("neutral");
  });

  it("keeps malware-only findings strong even when Modrinth has the file", () => {
    const report = fileReport(mod({ findings: ["minecraft_mod", "jar_sends_to_chat", "jar_session_token"] }), clean, new Date(), {
      mod: { status: "published", title: "Sodium", version: "0.9.3", projectUrl: "https://modrinth.com/project/AANobbMI" },
    });
    expect(report.level).toBe("high_risk");
    expect(report.evidence.find((item) => item.id === "file-jar_sends_to_chat")?.signal).toBe("raises_risk");
  });

  it("warns about a fake copy of a popular mod and says where to get the real one", () => {
    const report = fileReport(mod(), clean, new Date(), { mod: { status: "impostor", title: "Sodium", downloads: sodium.downloads, modId: "sodium", projectUrl: "https://modrinth.com/project/AANobbMI" } });
    expect(report.level).toBe("suspicious");
    expect(report.evidence[0]).toMatchObject({ id: "modrinth-impostor", title: "Says it is Sodium, but it is not a file Modrinth has" });
    expect(report.evidence[0]!.detail).toContain("(238,449,097 downloads)");
    expect(report.recommendations).toContain("Get Sodium from its own Modrinth or CurseForge page, not from a file someone sent.");
  });

  it("rates a session stealer as high risk and explains how to end stolen logins", () => {
    const report = fileReport(mod({ findings: ["minecraft_mod", "jar_session_token", "jar_sends_to_chat"] }), clean, new Date(), { mod: { status: "not_published" } });
    expect(report.level).toBe("high_risk");
    expect(report.evidence.some((item) => item.id === "modrinth-unknown")).toBe(true);
    expect(report.recommendations).toContain("If you already played with it, change your Microsoft and Discord passwords from another device and sign out of your other sessions, which ends stolen logins.");
  });

  it("lets account-tool capabilities make a file suspicious but never high risk on their own", () => {
    const tool = fileReport(mod({ findings: ["minecraft_mod", "jar_session_token", "jar_reads_accounts", "jar_hidden_download"] }), clean, new Date(), { mod: { status: "not_published" } });
    expect(tool.level).toBe("suspicious");
    const stealer = fileReport(mod({ findings: ["minecraft_mod", "jar_session_token", "jar_reads_accounts", "jar_hides_from_analysis"] }), clean, new Date(), { mod: { status: "not_published" } });
    expect(stealer.level).toBe("high_risk");
  });

  it("reports modpacks and a Modrinth outage", () => {
    const pack = fileReport(mod({ kind: "minecraft_modpack", extension: "mrpack", findings: ["modpack_carries_mods"], modId: undefined, packJars: [other] }), clean, new Date(), { pack: { status: "checked", total: 3, missing: 2 } });
    expect(pack.evidence.find((item) => item.id === "modrinth-pack-missing")?.title).toBe("2 of 3 mods it carries or gets from elsewhere are not on Modrinth");
    expect(pack.subject.display).toBe("Minecraft modpack (.mrpack), 1.8 MB");
    const known = fileReport(mod({ kind: "minecraft_modpack", extension: "mrpack", findings: [] }), clean, new Date(), { pack: { status: "checked", total: 3, missing: 0 } });
    expect(known.evidence.find((item) => item.id === "modrinth-pack-known")?.signal).toBe("neutral");
    const down = fileReport(mod(), clean, new Date(), { mod: { status: "unavailable" } });
    expect(down.notChecked).toContainEqual({ name: "Modrinth", reason: "unavailable" });
  });
});
