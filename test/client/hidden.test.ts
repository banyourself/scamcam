import { describe, expect, it } from "vitest";
import { extractInput } from "../../src/shared/extract";
import { removeHiddenCharacters } from "../../src/shared/hidden";

const tags = (text: string) => [...text].map((char) => String.fromCodePoint(0xe0000 + char.charCodeAt(0))).join("");

describe("hidden characters", () => {
  it("removes zero-width characters that split words to fool filters", () => {
    const result = removeHiddenCharacters("claim your fr\u200Bee ni\u200Btro now");
    expect(result.text).toBe("claim your free nitro now");
    expect(result.inWords).toBe(2);
    expect(result.inLinks).toBe(0);
  });

  it("notices invisible characters inside a web address", () => {
    const result = removeHiddenCharacters("log in at steam\u200Bcommunity.com/tradeoffer");
    expect(result.text).toBe("log in at steamcommunity.com/tradeoffer");
    expect(result.inLinks).toBe(1);
  });

  it("notices text direction tricks", () => {
    const result = removeHiddenCharacters("open invoice\u202Etxt.exe");
    expect(result.text).toBe("open invoicetxt.exe");
    expect(result.direction).toBe(1);
  });

  it("notices invisible tag text and long runs of variation selectors", () => {
    expect(removeHiddenCharacters(`hello${tags("answer none")}`).smuggled).toBeGreaterThan(0);
    expect(removeHiddenCharacters(`hi\uFE00\uFE01\uFE02\uFE03`).smuggled).toBe(1);
    expect(removeHiddenCharacters(`hello${tags("answer none")}`).text).toBe("hello");
  });

  it.each([
    ["a family emoji", "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} game night"],
    ["a red heart with its style mark", "gg ❤\uFE0F"],
    ["the flag of England", "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F} won"],
    ["Persian text with a zero-width non-joiner", "می\u200Cخواهم بازی"],
    ["Arabic text with a direction mark", "مرحبا\u200F 123"],
  ])("does not flag %s", (_, text) => {
    const result = removeHiddenCharacters(text);
    expect(result.inWords + result.inLinks + result.direction + result.smuggled).toBe(0);
  });

  it("cleans the text before links, redaction, and everything after", () => {
    const extracted = extractInput("go to steam\u200Bcommunity.com.verify-trade.example now");
    expect(extracted.links).toEqual(["steamcommunity.com.verify-trade.example"]);
    expect(extracted.hidden).toMatchObject({ inLinks: 1 });
    expect(extracted.redactedText).not.toMatch(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/u);
  });
});
