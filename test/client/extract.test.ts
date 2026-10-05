import { describe, expect, it } from "vitest";
import { extractInput, maxInputLength, maxLinks } from "../../src/shared/extract";

describe("extractInput", () => {
  it("finds links with and without a scheme and strips trailing punctuation", () => {
    const result = extractInput("check https://steamcommunity.com/tradeoffer/new/?partner=1 or discord-appeals.example/report!");
    expect(result.links).toEqual(["https://steamcommunity.com/tradeoffer/new/?partner=1", "discord-appeals.example/report"]);
  });

  it("keeps look-alike and punycode domains intact", () => {
    const lookalike = "stеamcommunity.com";
    const result = extractInput(`go to ${lookalike} and xn--stamcommunity-7gb.com now`);
    expect(result.links).toEqual([lookalike, "xn--stamcommunity-7gb.com"]);
  });

  it("hides emails, phone numbers, and codes before anything else", () => {
    const result = extractInput("mail me at kid.gamer@example.com or call +1 (714) 555-0199, code 482913");
    expect(result.redactions).toEqual({ emails: 1, phoneNumbers: 1, codes: 1 });
    expect(result.redactedText).not.toMatch(/kid\.gamer|555|482913/);
    expect(result.links).toEqual([]);
  });

  it("does not break numbers that are part of a link", () => {
    const result = extractInput("https://steamcommunity.example/tradeoffer/new/?partner=123456789&token=AbC");
    expect(result.links).toEqual(["https://steamcommunity.example/tradeoffer/new/?partner=123456789&token=AbC"]);
    expect(result.redactions.codes).toBe(0);
    expect(result.redactions.phoneNumbers).toBe(0);
  });

  it("removes duplicates and caps the number of links", () => {
    const many = Array.from({ length: maxLinks + 5 }, (_, i) => `site${i}.example`).join(" ");
    expect(extractInput(`${many} site0.example`).links).toHaveLength(maxLinks);
    expect(extractInput("a.example a.example").links).toEqual(["a.example"]);
  });

  it("truncates oversized input", () => {
    const result = extractInput("x".repeat(maxInputLength + 50));
    expect(result.truncated).toBe(true);
    expect(result.redactedText).toHaveLength(maxInputLength);
  });

  it("keeps the @ trick and raw IP links intact as links", () => {
    expect(extractInput("go to https://steamcommunity.com@steam-login.example/openid now").links).toEqual([
      "https://steamcommunity.com@steam-login.example/openid",
    ]);
    expect(extractInput("login at http://185.12.34.56/steam/login.php or 203.0.113.9").links).toEqual([
      "http://185.12.34.56/steam/login.php",
      "203.0.113.9",
    ]);
    expect(extractInput("my ip is 203.0.113.9").redactions.phoneNumbers).toBe(0);
  });

  it("returns nothing for plain text", () => {
    expect(extractInput("gg wp, see you tomorrow").links).toEqual([]);
  });
});
