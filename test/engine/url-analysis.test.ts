import { describe, expect, it } from "vitest";
import { editDistance, skeleton } from "../../src/engine/confusables";
import { decodePunycodeLabel, hostnameToUnicode } from "../../src/engine/punycode";
import { strengthPoints } from "../../src/engine/signals";
import { analyzeLink } from "../../src/engine/url-analysis";

function raised(link: string) {
  return analyzeLink(link).signals.filter((signal) => signal.direction === "raises");
}

function score(link: string): number {
  return raised(link).reduce((total, signal) => total + strengthPoints[signal.strength], 0);
}

describe("punycode and look-alike helpers", () => {
  it("decodes punycode labels like Node's reference implementation", () => {
    expect(decodePunycodeLabel("mnchen-3ya")).toBe("münchen");
    expect(decodePunycodeLabel("80ak6aa92e")).toBe("аррӏе");
    expect(decodePunycodeLabel("stamcommunity-x3k")).toBe("stеamcommunity");
    expect(hostnameToUnicode("xn--bcher-kva.example")).toBe("bücher.example");
    expect(decodePunycodeLabel("!!!")).toBeNull();
  });

  it("maps look-alike characters to the same skeleton", () => {
    expect(skeleton("stеamcommunity")).toBe(skeleton("steamcommunity"));
    expect(skeleton("rob1ox")).toBe(skeleton("roblox"));
    expect(skeleton("discorcl")).toBe(skeleton("discord"));
    expect(skeleton("rnicrosoft")).toBe(skeleton("microsoft"));
  });

  it("counts transpositions as one edit", () => {
    expect(editDistance("steam", "staem")).toBe(1);
    expect(editDistance("roblox", "roblux")).toBe(1);
    expect(editDistance("discord", "discord")).toBe(0);
  });
});

describe("official and well-known sites", () => {
  it.each([
    "https://steamcommunity.com/tradeoffer/new/?partner=123&token=AbC",
    "https://store.steampowered.com/app/730/",
    "discord.gg/minecraft",
    "https://www.roblox.com/games/1/adopt-me",
    "https://www.minecraft.net/en-us/download",
    "https://cdn.akamai.steamstatic.com/client/installer/SteamSetup.exe",
    "https://login.live.com/",
  ])("trusts %s", (link) => {
    const result = analyzeLink(link);
    expect(result.officialBrand).not.toBeNull();
    expect(raised(link)).toEqual([]);
  });

  it("marks well-known community sites without warnings", () => {
    const result = analyzeLink("https://steamdb.info/app/730/");
    expect(result.communitySite).toBe("steamdb.info");
    expect(raised("https://steamdb.info/app/730/")).toEqual([]);
  });

  it("still warns about programs uploaded to official chat file hosts", () => {
    const signals = raised("https://cdn.discordapp.com/attachments/1/2/FreeNitro.exe");
    expect(signals.map((signal) => signal.strength)).toEqual(["strong"]);
    expect(signals[0]!.title).toContain("someone uploaded");
  });
});

describe("tricks", () => {
  it("catches a one-letter typo of steamcommunity with a trade path", () => {
    const signals = raised("steamcommunlty.example/tradeoffer/new/?partner=1");
    expect(signals.some((signal) => signal.lookalike && signal.strength === "strong")).toBe(true);
    expect(score("steamcommunlty.example/tradeoffer/new/?partner=1")).toBeGreaterThanOrEqual(6);
  });

  it("treats letters from another alphabet as a critical disguise", () => {
    for (const link of ["https://stеamcommunity.com/login", "https://xn--stamcommunity-x3k.com/login"]) {
      expect(raised(link).some((signal) => signal.strength === "critical" && signal.lookalike)).toBe(true);
    }
  });

  it("sees through the @ trick", () => {
    const result = analyzeLink("https://steamcommunity.com@steam-login.example/openid");
    expect(result.hostname).toBe("steam-login.example");
    expect(result.officialBrand).toBeNull();
    expect(result.signals.some((signal) => signal.id.startsWith("userinfo") && signal.strength === "critical")).toBe(true);
  });

  it("catches official names used as a prefix", () => {
    expect(raised("steamcommunity.com.trade-offer.example/login").some((signal) => signal.id.startsWith("prefix"))).toBe(true);
  });

  it("catches copied and disguised names inside hyphenated domains", () => {
    expect(raised("https://steamcommunity-trade.example/tradeoffer").some((signal) => signal.id.startsWith("name-copy"))).toBe(true);
    expect(raised("d1scord-gift.example/claim").some((signal) => signal.id.startsWith("name-copy") && signal.strength === "strong")).toBe(true);
  });

  it("catches the right name with the wrong ending", () => {
    expect(raised("https://steampowered.ru/login").some((signal) => signal.id.startsWith("wrong-ending"))).toBe(true);
    expect(raised("https://steamcommunity.pages.dev/login").some((signal) => signal.id.startsWith("wrong-ending"))).toBe(true);
  });

  it("flags IP loggers, raw IPs, shorteners, and free hosting", () => {
    expect(raised("https://grabify.link/ABC123")[0]!.strength).toBe("strong");
    expect(raised("http://185.12.34.56/steam/login.php").map((signal) => signal.id.split("-")[0])).toEqual(["ip", "no"]);
    expect(raised("https://bit.ly/3xYzAbC")[0]!.strength).toBe("weak");
    expect(raised("https://discord-nitro.pages.dev/gift").length).toBeGreaterThanOrEqual(3);
  });

  it("keeps honest fan sites and look-alike words low", () => {
    expect(score("https://my-minecraft-server.example/rules")).toBeLessThanOrEqual(1);
    expect(score("https://steamcleaning.example/")).toBeLessThanOrEqual(1);
    expect(score("https://www.youtube.com/watch?v=abc")).toBe(0);
    expect(score("https://en.wikipedia.org/wiki/Phishing")).toBe(0);
  });

  it("reports unreadable links without crashing", () => {
    expect(analyzeLink("http://exa mple.com").hostname).toBeNull();
  });
});
