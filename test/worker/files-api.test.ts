import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { memoryLookupCache } from "../../src/engine/cache";
import type { ScanReport } from "../../src/shared/report";
import { reportSignatureHeader } from "../../src/shared/share";
import { createApp } from "../../src/worker/app";
import { reportIsAuthentic } from "../../src/worker/security/report-signature";
import { fakeNetwork, type FakeNetworkOptions } from "../engine/fake-network";

const origin = "https://scamcam.kevinle.tech";
const sha256 = "c".repeat(64);
const sha1 = "d".repeat(40);
let nextAddress = 1;

async function post(path: string, body: unknown, network: FakeNetworkOptions = {}, scans: "inline" | "scanner" = "inline") {
  const fake = fakeNetwork(network);
  const app = createApp({ fetcher: fake.fetcher, lookupCache: memoryLookupCache(), scans });
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`${origin}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, "CF-Connecting-IP": `198.18.0.${nextAddress++}` },
      body: JSON.stringify(body),
    }),
    { ...env, URLHAUS_AUTH_KEY: "test-key" },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return { response, fake };
}

const program = { sha256, sha1, size: 812_000, kind: "windows_program", extension: "exe", findings: ["double_extension"], turnstileToken: "t" };

describe("POST /api/v1/files", () => {
  it("returns a signed file report built from the fingerprint and findings", async () => {
    const { response, fake } = await post("/api/v1/files", program, { malware: { [sha256]: "AsyncRAT" } });
    expect(response.status).toBe(200);
    const report = await response.json<ScanReport>();
    expect(report.subject.kind).toBe("file");
    expect(report.level).toBe("confirmed_malicious");
    expect(report.evidence[0]!.title).toBe("MalwareBazaar lists this exact file as AsyncRAT");
    expect(await reportIsAuthentic(report, response.headers.get(reportSignatureHeader)!, env.SHARE_SIGNING_KEY)).toBe(true);
    const bazaar = fake.requests.find((entry) => entry.url.includes("mb-api.abuse.ch"));
    expect(bazaar?.body).toBe(`query=get_info&hash=${sha256}`);
  });

  it.each([
    ["an unknown field such as the file name", { ...program, name: "My Plans.exe" }],
    ["an unknown finding", { ...program, findings: ["looks_bad"] }],
    ["a malformed fingerprint", { ...program, sha256: "xyz" }],
    ["an extension with odd characters", { ...program, extension: "ex e" }],
  ])("refuses %s", async (_label, body) => {
    const { response, fake } = await post("/api/v1/files", body);
    expect(response.status).toBe(400);
    expect(fake.requests).toEqual([]);
  });

  it("checks nothing when the bot check fails", async () => {
    const { response, fake } = await post("/api/v1/files", program, { turnstile: { success: false, "error-codes": ["invalid-input-response"] } });
    expect(response.status).toBe(403);
    expect(fake.requests.map((entry) => new URL(entry.url).hostname)).toEqual(["challenges.cloudflare.com"]);
  });

  it("lets a file report be shared like any other report", async () => {
    const { response } = await post("/api/v1/files", program);
    const report = await response.json<ScanReport>();
    const share = await post("/api/v1/shares", { report, signature: response.headers.get(reportSignatureHeader), minutes: 5, includeMessage: false });
    expect(share.response.status).toBe(201);
  });

  it.each([
    ["a mod ID with odd characters", { ...program, kind: "java_archive", extension: "jar", findings: ["minecraft_mod"], modId: "Sodium Mod" }],
    ["too many modpack fingerprints", { ...program, kind: "minecraft_modpack", extension: "mrpack", findings: [], packJars: Array.from({ length: 51 }, (_, index) => index.toString(16).padStart(40, "0")) }],
    ["a malformed modpack fingerprint", { ...program, kind: "minecraft_modpack", extension: "mrpack", findings: [], packJars: ["xyz"] }],
  ])("refuses %s", async (_label, body) => {
    const { response, fake } = await post("/api/v1/files", body);
    expect(response.status).toBe(400);
    expect(fake.requests).toEqual([]);
  });

  it("compares a Minecraft mod with Modrinth and flags a fake copy of a popular mod", async () => {
    const mod = { ...program, kind: "java_archive", extension: "jar", findings: ["minecraft_mod"], modId: "sodium" };
    const { response, fake } = await post("/api/v1/files", mod, { modrinthProjects: [{ id: "AANobbMI", slug: "sodium", title: "Sodium", downloads: 238_449_097 }] });
    const report = await response.json<ScanReport>();
    expect(report.level).toBe("suspicious");
    expect(report.evidence[0]!.title).toBe("Says it is Sodium, but it is not a file Modrinth has");
    expect(fake.requests.filter((entry) => entry.url.startsWith("https://api.modrinth.com/")).map((entry) => entry.url)).toEqual([
      `https://api.modrinth.com/v2/version_file/${sha1}?algorithm=sha1`,
      "https://api.modrinth.com/v2/project/sodium",
    ]);
  });

  it("asks Modrinth only about Minecraft mods and modpacks", async () => {
    const { fake } = await post("/api/v1/files", { ...program, modId: "sodium" });
    expect(fake.requests.some((entry) => entry.url.includes("modrinth"))).toBe(false);
    const pack = await post("/api/v1/files", { ...program, kind: "minecraft_modpack", extension: "mrpack", findings: ["modpack_carries_mods"], packJars: [sha1, sha1] }, { modrinthFiles: { [sha1]: { project: "AANobbMI", version: "1" } } });
    const report = await pack.response.json<ScanReport>();
    expect(report.evidence.find((item) => item.id === "modrinth-pack-known")?.title).toBe("Modrinth has every mod this pack carries or gets from elsewhere");
    expect(JSON.parse(pack.fake.requests.find((entry) => entry.url.endsWith("/version_files"))!.body)).toEqual({ hashes: [sha1], algorithm: "sha1" });
  });

  it("runs in the scanner Durable Object", async () => {
    const { sha256: _hash, sha1: _sha1, ...unfingerprinted } = program;
    const { response } = await post("/api/v1/files", { ...unfingerprinted, findings: ["too_large_to_hash"] }, {}, "scanner");
    expect(response.status).toBe(200);
    const report = await response.json<ScanReport>();
    expect(report.subject.display).toBe("Windows program (.exe), 793 KB");
    expect(report.notChecked).toContainEqual({ name: "Malware lists", reason: "skipped" });
  });
});
