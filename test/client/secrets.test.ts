import { describe, expect, it } from "vitest";
import { extractInput } from "../../src/shared/extract";
import { hideSecrets, secretPlaceholder } from "../../src/shared/secrets";

const discordToken = ["MTIzNDU2Nzg5MDEyMzQ1Njc4", "GabcDE", "abcdefghijklmnopqrstuvwxyz0123456789AB"].join(".");
const robloxCookie = `_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you-and-to-steal-your-ROBUX-and-items.|_${"A1B2C3D4".repeat(12)}`;
const steamCookie = `76561198000000000%7C%7C${["eyJhbGciOiJFZERTQSJ9", "eyJpc3MiOiJyOnN0ZWFtIn0", "c2lnbmF0dXJlLXZhbHVl"].join(".")}`;
const githubToken = `ghp_${"Ab3".repeat(12)}`;
const fineGrained = `github_pat_${"A".repeat(22)}_${"b".repeat(59)}`;

describe("hideSecrets", () => {
  it("replaces login tokens and cookies with a label and lists their kinds once", () => {
    const text = `my token ${discordToken} and again ${discordToken}\ncookie ${robloxCookie}\nsteam ${steamCookie}\n${githubToken} ${fineGrained}`;
    const result = hideSecrets(text);
    expect(result.found).toEqual(["discord_token", "roblox_cookie", "steam_cookie", "github_token"]);
    expect(result.text).not.toContain(discordToken);
    expect(result.text).not.toContain("A1B2C3D4");
    expect(result.text).not.toContain("eyJ");
    expect(result.text).not.toContain("ghp_");
    expect(result.text).not.toContain("github_pat_");
    expect(result.text).toContain(`my token ${secretPlaceholder("discord_token")} and again ${secretPlaceholder("discord_token")}`);
    expect(result.text).toContain(`cookie ${secretPlaceholder("roblox_cookie")}`);
  });

  it("recognizes text the browser already cleaned, so the server still warns", () => {
    const cleaned = hideSecrets(`paste this: ${robloxCookie}`).text;
    expect(hideSecrets(cleaned)).toEqual({ text: cleaned, found: ["roblox_cookie"] });
  });

  it("finds a Roblox cookie whose value was cut off", () => {
    expect(hideSecrets("_|WARNING:-DO-NOT-SHARE-THIS.--Sharing-this-will-allow-someone-to-log-in-as-you.|_").found).toEqual(["roblox_cookie"]);
  });

  it("leaves ordinary text, links, account numbers, and look-alike strings alone", () => {
    const ordinary = [
      "Meet me at N.abcdef.x tomorrow",
      "https://discord.com/invite/abc123 and https://www.roblox.com/users/123/profile",
      "My Steam ID is 76561198000000000",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturepart1234567890",
      "ghp_short and github_pat_tooshort",
      "Version MTIz.abc.def is out",
    ];
    for (const text of ordinary) {
      expect(hideSecrets(text), text).toEqual({ text, found: [] });
    }
  });
});

describe("extractInput with secrets", () => {
  it("removes secrets before links, emails, and codes are read, so no part of them is checked as a link", () => {
    const result = extractInput(`Support said to send ${discordToken} to verify at discord-help.example`);
    expect(result.secrets).toEqual(["discord_token"]);
    expect(result.redactedText).toContain(secretPlaceholder("discord_token"));
    expect(result.links).toEqual(["discord-help.example"]);
    expect(result.redactions.codes).toBe(0);
  });

  it("lists no secrets for ordinary text", () => {
    expect(extractInput("free robux at robux-gift.example").secrets).toEqual([]);
  });
});
