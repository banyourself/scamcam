import { describe, expect, it } from "vitest";
import { extractInput, maxInputLength, maxLinks, withoutQrLabels } from "../../src/shared/extract";

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

  it("keeps underscores inside host names", () => {
    expect(extractInput("look at 10000susan_gilbert.goodluckseeker.example/login").links).toEqual(["10000susan_gilbert.goodluckseeker.example/login"]);
  });

  it("labels US phone numbers, even without dashes, and keeps a normalized copy that never enters the text", () => {
    const result = extractInput("17607662951 left a message. Call +1 (469) 982-5001 or 469.982.5001, code 482913, order #2345678901");
    expect(result.redactions).toEqual({ emails: 0, phoneNumbers: 3, codes: 2 });
    expect(result.phones).toEqual(["+17607662951", "+14699825001"]);
    expect(result.redactedText).toBe("[number hidden] left a message. Call [number hidden] or [number hidden], code [code hidden], order #[code hidden]");
    expect(extractInput("https://example.com/call/7145550199?ref=7145550199").phones).toEqual([]);
    expect(extractInput("call +44 20 7946 0958").phones).toEqual([]);
    expect(extractInput(Array.from({ length: 8 }, (_, index) => `714555010${index}`).join(" ")).phones).toHaveLength(5);
  });

  it("finds wallet addresses in lowercase, including inside links, and leaves longer hex strings alone", () => {
    const wallet = `0x${"7538fd1e30".repeat(4)}`;
    const upper = `0x${"ABCDEF0123".repeat(4)}`;
    const result = extractInput(`send 0.5 ETH to ${wallet}, or ${upper}. Tx: 0x${"f".repeat(64)} https://etherscan.io/address/${wallet}`);
    expect(result.wallets).toEqual([wallet, upper.toLowerCase()]);
    expect(result.redactedText).toContain(wallet);
    expect(extractInput(Array.from({ length: 8 }, (_, index) => `0x${String(index).repeat(40)}`).join(" ")).wallets).toHaveLength(5);
  });

  it("returns nothing for plain text", () => {
    expect(extractInput("gg wp, see you tomorrow").links).toEqual([]);
  });
});

describe("withoutQrLabels", () => {
  it("removes only the label in front of a single QR value", () => {
    expect(withoutQrLabels("hello\nQR code: https://a.example/x")).toBe("hello\nhttps://a.example/x");
    expect(withoutQrLabels("QR code: scan me to log in")).toBe("QR code: scan me to log in");
    expect(withoutQrLabels("my QR code: https://a.example/x")).toBe("my QR code: https://a.example/x");
  });
});
