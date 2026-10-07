import { describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { discordInviteEndpoint, inviteAnswerFrom, serverCreatedAt } from "../../src/engine/discord-invite";
import { staffClaimIn } from "../../src/engine/brands";
import { scanContent, type ScanOptions } from "../../src/engine/scan";
import { steamApiBase } from "../../src/engine/steam";
import { analyzeLink } from "../../src/engine/url-analysis";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { allowAllBudgets, fakeNetwork, type FakeNetworkOptions } from "./fake-network";

const now = new Date("2026-10-06T12:00:00.000Z");
const steamKey = "steam-test-key-value";
const scammer = "76561198000000001";
const friend = "76561198000000002";

function scanner(network: FakeNetworkOptions = {}, extra: Partial<ScanOptions> = {}) {
  const fake = fakeNetwork({ now, ...network });
  const scan: ScanOptions = { fetcher: fake.fetcher, takeBudget: allowAllBudgets, now, extendedLookups: true, steamKey, ...extra };
  return { fake, scan };
}

function hostsOf(requests: { url: string }[]): string[] {
  return requests.map((request) => new URL(request.url).hostname);
}

describe("reading Discord invites and Steam accounts from links", () => {
  it.each([
    ["discord.gg/AbC-123", "AbC-123"],
    ["https://discord.com/invite/minecraft", "minecraft"],
    ["https://canary.discord.com/invite/minecraft/", "minecraft"],
    ["https://discordapp.com/invite/xyz99", "xyz99"],
  ])("reads the invite code in %s", (link, code) => {
    expect(analyzeLink(link).discordInvite).toBe(code);
  });

  it.each(["https://discord.com/channels/1/2", "https://discord.gg/", "https://discord-gift.example/invite/abc", "https://discord.com/invite/a"])(
    "finds no invite in %s",
    (link) => {
      expect(analyzeLink(link).discordInvite).toBeNull();
    },
  );

  it("reads Steam profiles, custom profile names, and trade offer partners", () => {
    expect(analyzeLink(`https://steamcommunity.com/profiles/${scammer}`).steamAccount).toEqual({ kind: "id", value: scammer });
    expect(analyzeLink("https://steamcommunity.com/id/kevin/").steamAccount).toEqual({ kind: "vanity", value: "kevin" });
    expect(analyzeLink("https://steamcommunity.com/tradeoffer/new/?partner=1&token=AbCd").steamAccount).toEqual({ kind: "id", value: "76561197960265729" });
    expect(analyzeLink("https://steamcommunity.com/market/listings/730/x").steamAccount).toBeNull();
    expect(analyzeLink("https://steamcommunlty.example/id/kevin").steamAccount).toBeNull();
    expect(analyzeLink("https://steamcommunity.com/tradeoffer/new/?partner=0").steamAccount).toBeNull();
  });

  it("tells staff and support names apart from ordinary ones", () => {
    expect(staffClaimIn("Steam Support Team")?.id).toBe("steam");
    expect(staffClaimIn("DISCORD_TRUST_&_SAFETY")?.id).toBe("discord");
    expect(staffClaimIn("Roblox Moderators | Appeals")?.id).toBe("roblox");
    expect(staffClaimIn("Minecraft Builders")).toBeNull();
    expect(staffClaimIn("Support Group for Gamers")).toBeNull();
  });

  it("works out when a Discord server was made from its ID", () => {
    expect(serverCreatedAt("302094807046684672")).toBe("2017-04-13T14:56:54.650Z");
    expect(serverCreatedAt("not a number")).toBeNull();
    expect(inviteAnswerFrom({ code: "x", type: 1, channel: { id: "1" } })).toEqual({ status: "ok", createdAt: null, verified: false, partnered: false, members: null, claimsBrand: null });
    expect(inviteAnswerFrom({ nope: true })).toBeNull();
  });
});

describe("Discord invites in scans", () => {
  it("warns about a new server whose name claims to be support staff, sending Discord only the invite code", async () => {
    const { scan, fake } = scanner({ discord: { steamhelp: { name: "Steam Support Center", createdDaysAgo: 2 } } });
    const report = await scanContent("your account was reported, join our support server discord.gg/steamhelp", scan);
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(["suspicious", "high_risk"]).toContain(report.level);
    expect(report.evidence.find((item) => item.id === "discord-impostor-steamhelp")).toMatchObject({
      signal: "raises_risk",
      title: "This server's name claims to be Steam staff or support",
      source: { name: "Discord server details", url: "https://discord.com/developers/docs/resources/invite" },
    });
    expect(report.evidence.find((item) => item.id === "discord-new-steamhelp")?.title).toBe("This Discord server was made 2 days ago");
    expect(JSON.stringify(report)).not.toContain("Steam Support Center");
    expect(fake.requests.map((request) => request.url)).toEqual([`${discordInviteEndpoint}steamhelp?with_counts=true`]);
    expect(fake.requests[0]!.headers.get("Authorization")).toBeNull();
  });

  it("lowers the risk for a server Discord has verified, but no longer calls an invite an official website", async () => {
    const report = await scanContent("discord.gg/minecraft", scanner({ discord: { minecraft: { name: "MINECRAFT", features: ["VERIFIED", "COMMUNITY"] } } }).scan);
    expect(report.evidence.find((item) => item.id === "discord-verified-minecraft")?.signal).toBe("lowers_risk");
    expect(report.evidence.find((item) => item.id === "discord-invite-discord.gg")?.title).toBe("This is an invite to a Discord server");
    expect(report.evidence.some((item) => item.signal === "raises_risk")).toBe(false);
    expect(report.summary).not.toBe("This link goes to Discord's official website.");
    expect(["no_known_threat", "unknown"]).toContain(report.level);
  });

  it("does not credit a verified server when the invite was only read from a screenshot", async () => {
    const report = await scanContent("discord.gg/minecraft", scanner({ discord: { minecraft: { features: ["VERIFIED"] } } }, { fromScreenshot: true }).scan);
    expect(report.evidence.some((item) => item.signal === "lowers_risk")).toBe(false);
  });

  it("does not call a server Discord has verified an impostor", async () => {
    const report = await scanContent("discord.gg/robloxsupport", scanner({ discord: { robloxsupport: { name: "Roblox Support", features: ["VERIFIED"] } } }).scan);
    expect(report.evidence.some((item) => item.id === "discord-impostor-robloxsupport")).toBe(false);
  });

  it("says when an invite no longer works, and handles group chat invites", async () => {
    const gone = await scanContent("discord.gg/oldscam", scanner().scan);
    expect(gone.evidence.find((item) => item.id === "discord-gone-oldscam")).toMatchObject({ signal: "neutral", title: "This Discord invite does not work anymore" });
    const group = await scanContent("discord.gg/friends", scanner({ discord: { friends: { groupChat: true } } }).scan);
    expect(group.evidence.some((item) => item.source.name === "Discord server details")).toBe(false);
    expect(group.notChecked.some((item) => item.name === "Discord server details")).toBe(false);
  });

  it("sends a bot token only when one is set, and only to Discord", async () => {
    const { scan, fake } = scanner({ discord: { minecraft: { features: ["VERIFIED"] } } }, { discordToken: "discord-test-token" });
    const report = await scanContent("discord.gg/minecraft https://cheap-skins.example/", scan);
    const discord = fake.requests.filter((request) => request.url.startsWith(discordInviteEndpoint));
    expect(discord.map((request) => request.headers.get("Authorization"))).toEqual(["Bot discord-test-token"]);
    expect(fake.requests.filter((request) => !request.url.startsWith(discordInviteEndpoint)).some((request) => JSON.stringify([...request.headers]).includes("discord-test-token"))).toBe(false);
    expect(JSON.stringify(report)).not.toContain("discord-test-token");
  });

  it("says when Discord did not answer, and checks at most two invites", async () => {
    const limited = await scanContent("discord.gg/aaaa", scanner({ discordStatus: 429 }).scan);
    expect(limited.notChecked).toContainEqual({ name: "Discord server details", reason: "unavailable" });
    const { scan, fake } = scanner();
    await scanContent("discord.gg/aaaa discord.gg/bbbb discord.gg/cccc discord.gg/aaaa", scan);
    expect(fake.requests.filter((request) => request.url.startsWith(discordInviteEndpoint))).toHaveLength(2);
  });

  it("asks Discord only from the scanner, and answers a repeat from memory", async () => {
    const inline = scanner({}, { extendedLookups: false });
    await scanContent("discord.gg/minecraft", inline.scan);
    expect(inline.fake.requests).toEqual([]);
    const lookups = memoryLookups();
    const { scan, fake } = scanner({ discord: { minecraft: { features: ["VERIFIED"] } } }, { lookups });
    await scanContent("discord.gg/minecraft", scan);
    await scanContent("discord.gg/minecraft", scan);
    expect(fake.requests).toHaveLength(1);
  });
});

describe("Steam accounts in scans", () => {
  it("warns strongly about a trade-banned account and sends the key only to Steam", async () => {
    const { scan, fake } = scanner({ steamVanity: { tradeguy: scammer }, steam: { [scammer]: { economyBan: "banned" } } });
    const report = await scanContent("add me to trade, my profile https://steamcommunity.com/id/tradeguy", scan);
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(report.evidence.find((item) => item.id === "steam-trade-ban-vanity-tradeguy")).toMatchObject({
      signal: "raises_risk",
      title: "Steam has banned this account from trading",
      source: { name: "Steam account details (Steam Web API)", url: "https://steamcommunity.com/dev" },
    });
    expect(["unknown", "suspicious"]).toContain(report.level);
    expect(fake.requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/ISteamUser/ResolveVanityURL/v1/",
      "/ISteamUser/GetPlayerBans/v1/",
      "/ISteamUser/GetPlayerSummaries/v2/",
    ]);
    expect(fake.requests.every((request) => request.url.startsWith(steamApiBase) && new URL(request.url).searchParams.get("key") === steamKey)).toBe(true);
    expect(JSON.stringify(report)).not.toContain(steamKey);
  });

  it("flags a brand-new account named like Steam staff behind a trade offer", async () => {
    const partner = "76561197960265729";
    const { scan, fake } = scanner({ steam: { [partner]: { name: "Valve Support", createdDaysAgo: 3 } } });
    const report = await scanContent("https://steamcommunity.com/tradeoffer/new/?partner=1&token=AbCd", scan);
    expect(report.evidence.map((item) => item.id)).toEqual(expect.arrayContaining([`steam-impostor-id-${partner}`, `steam-new-id-${partner}`]));
    expect(report.evidence.find((item) => item.id === `steam-new-id-${partner}`)?.title).toBe("This Steam account was made 3 days ago");
    expect(JSON.stringify(report)).not.toContain("Valve Support");
    expect(fake.requests.some((request) => request.url.includes("ResolveVanityURL"))).toBe(false);
    expect(report.level).toBe("high_risk");
  });

  it("leaves an ordinary account as it was, notes game bans as background, and skips the age of a private profile", async () => {
    const clean = await scanContent(`https://steamcommunity.com/profiles/${friend}`, scanner({ steam: { [friend]: { createdDaysAgo: 3000 } } }).scan);
    expect(clean.level).toBe("no_known_threat");
    expect(clean.evidence.some((item) => item.signal === "raises_risk")).toBe(false);
    expect(clean.evidence.find((item) => item.id === `steam-clean-id-${friend}`)).toMatchObject({ signal: "neutral", title: "Steam shows no bans on this account, made 8 years ago" });
    const banned = await scanContent(`https://steamcommunity.com/profiles/${friend}`, scanner({ steam: { [friend]: { vacBans: 1, gameBans: 1 } } }).scan);
    expect(banned.evidence.find((item) => item.id === `steam-game-bans-id-${friend}`)).toMatchObject({ signal: "neutral", title: "This Steam account has 2 game bans" });
    const hidden = await scanContent(`https://steamcommunity.com/profiles/${friend}`, scanner({ steam: { [friend]: { createdDaysAgo: 1, visibility: 1 } } }).scan);
    expect(hidden.evidence.some((item) => item.id.startsWith("steam-new-"))).toBe(false);
    expect(hidden.evidence.find((item) => item.id.startsWith("steam-clean-"))?.title).toBe("Steam shows no bans on this account");
    expect(banned.evidence.some((item) => item.id.startsWith("steam-clean-"))).toBe(false);
  });

  it("says when a profile does not exist without asking for its bans", async () => {
    const { scan, fake } = scanner();
    const report = await scanContent("https://steamcommunity.com/id/nobody-here", scan);
    expect(report.evidence.find((item) => item.id === "steam-missing-vanity-nobody-here")?.title).toBe("This Steam profile does not exist");
    expect(fake.requests).toHaveLength(1);
  });

  it("checks two accounts in one call each, and remembers them", async () => {
    const lookups = memoryLookups();
    const { scan, fake } = scanner({ steam: { [scammer]: { communityBanned: true }, [friend]: {} } }, { lookups });
    const content = `https://steamcommunity.com/profiles/${scammer} https://steamcommunity.com/profiles/${friend} https://steamcommunity.com/profiles/76561198000000003`;
    const report = await scanContent(content, scan);
    expect(report.evidence.some((item) => item.id === `steam-community-ban-id-${scammer}`)).toBe(true);
    expect(fake.requests).toHaveLength(2);
    expect(new URL(fake.requests[0]!.url).searchParams.get("steamids")).toBe(`${scammer},${friend}`);
    await scanContent(content, scan);
    expect(fake.requests).toHaveLength(2);
  });

  it("says when Steam is not connected or did not answer", async () => {
    const missing = scanner({}, { steamKey: undefined });
    const report = await scanContent("https://steamcommunity.com/id/kevin", missing.scan);
    expect(report.notChecked).toContainEqual({ name: "Steam account details (Steam Web API)", reason: "not_configured" });
    expect(missing.fake.requests).toEqual([]);
    const down = await scanContent("https://steamcommunity.com/id/kevin", scanner({ steamStatus: 403 }).scan);
    expect(down.notChecked).toContainEqual({ name: "Steam account details (Steam Web API)", reason: "unavailable" });
    expect(down.level).toBe("no_known_threat");
  });

  it("never sends Steam or Discord anything from links on other sites", async () => {
    const { scan, fake } = scanner();
    await scanContent("https://steamcommunlty.example/id/kevin https://discord-gift.example/invite/abc", scan);
    expect(hostsOf(fake.requests).filter((host) => host === "discord.com" || host === "api.steampowered.com")).toEqual([]);
  });
});
