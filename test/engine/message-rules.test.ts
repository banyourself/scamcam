import { describe, expect, it } from "vitest";
import { analyzeMessage, foldLeetspeak } from "../../src/engine/message-rules";

function ids(text: string): string[] {
  return analyzeMessage(text).signals.map((signal) => signal.id.replace("message-", ""));
}

describe("message rules", () => {
  it.each([
    ["hey sorry, I accidentally reported your account. Contact the Discord staff to fix it", ["false-report", "account-threat", "staff-impersonation"]],
    ["FR33 N1TRO for the first 100 people, claim fast", ["free-reward", "urgency"]],
    ["can you test my game? download the launcher and run setup.exe", ["game-testing"]],
    ["send me your 2fa code so i can verify the trade", ["credential-request", "trade-verify"]],
    ["scan this QR code with the discord app to claim your free nitro", ["qr-login", "free-reward"]],
    ["to get the robux, open inspect element and paste this in the console", ["cookie-token"]],
    ["give me the items and I'll hold them, I'm a trusted middleman", ["hand-over-items", "middleman"]],
    ["vote for my team in the tournament pls", ["vote-scam"]],
    ["pay me with steam gift cards and I'll send the knife after", ["gift-card-payment"]],
    ["add me on telegram, i'll give you free skins", ["free-reward", "move-off-platform"]],
    ["Your Steam account will be banned in 24 hours, log in here to verify", ["account-threat", "urgency", "login-link"]],
    ["can you screen share so I can verify you own the account", ["screen-share", "trade-verify"]],
  ])("flags %j", (text, expected) => {
    expect(ids(text)).toEqual(expect.arrayContaining(expected));
  });

  it.each([
    "gg wp, want to play again tomorrow?",
    "are you free tonight? we need one more for ranked",
    "lol my account got banned from that minecraft server for spamming",
    "can you send me the homework link?",
    "I'll pay you back for the pizza tomorrow",
    "my steam guard code isn't arriving, any idea why?",
    "Reminder: never share your password or 2FA code with anyone",
    "don't scan QR codes from strangers",
    "join my server, it has a minecraft event this weekend",
  ])("stays quiet for %j", (text) => {
    expect(analyzeMessage(text).signals.filter((signal) => signal.strength !== "weak")).toEqual([]);
  });

  it("still catches a request after a negated phrase", () => {
    expect(ids("don't worry, just send me your password")).toContain("credential-request");
  });

  it("reports the scam family", () => {
    expect(analyzeMessage("I accidentally reported you").families).toEqual(["false_report"]);
  });

  it("folds leetspeak only inside words", () => {
    expect(foldLeetspeak("fr33 n1tr0 for 100 people")).toBe("free nitro for 100 people");
  });
});
