import { describe, expect, it } from "vitest";
import { guessingTime } from "../../src/client/components/breaches/PasswordTools";
import { effLargeWordlist } from "../../src/client/data/eff-wordlist";
import { buildPassphrase, describeStrength, effWordCount, loadStrengthChecker, loadWordlist, randomBelow } from "../../src/client/lib/password-tools";

describe("passphrases", () => {
  it("uses the full EFF long word list", async () => {
    const words = await loadWordlist();
    expect(words).toHaveLength(effWordCount);
    expect(new Set(words).size).toBe(effWordCount);
    expect(words.every((word) => /^[a-z-]{3,9}$/.test(word))).toBe(true);
    expect(effLargeWordlist.startsWith("abacus abdomen")).toBe(true);
  });

  it("throws away random values that would make some words more likely", () => {
    const values = [2 ** 32 - 1, 2 ** 32 - 2, 7777];
    const random = (bytes: Uint32Array<ArrayBuffer>) => {
      bytes[0] = values.shift()!;
      return bytes;
    };
    expect(randomBelow(7776, random)).toBe(1);
    expect(values).toEqual([]);
  });

  it("joins the chosen words and counts their randomness", () => {
    const words = ["alpha", "bravo", "charlie", "delta"];
    const picks = [0, 1, 2, 3, 7];
    const pick = () => picks.shift()!;
    expect(buildPassphrase(words, 4, "-", false, pick)).toEqual({ phrase: "alpha-bravo-charlie-delta", bits: 8 });
    expect(buildPassphrase(words, 1, " ", true, () => 2)).toEqual({ phrase: "Charlie 2", bits: 5 });
    const real = buildPassphrase(Array.from({ length: effWordCount }, (_, index) => `w${index}`), 6, ".", false);
    expect(real.phrase.split(".")).toHaveLength(6);
    expect(real.bits).toBe(77);
  });

  it("describes guessing times in plain words", () => {
    expect(guessingTime(77)).toBe("about 2,394 years");
    expect(guessingTime(40)).toBe("less than a day");
    expect(guessingTime(60)).toBe("about 7 days");
    expect(guessingTime(160)).toBe("more than a billion years");
  });
});

describe("password strength", () => {
  it("rates common passwords as very weak and long random passphrases as very strong, with English feedback", async () => {
    const checker = await loadStrengthChecker();
    const weak = describeStrength(checker.check("password1"));
    expect(weak.score).toBe(0);
    expect(weak.label).toBe("Very weak");
    expect(weak.warning).toBeTruthy();
    expect(weak.offline).toMatch(/less than a second|second/);
    const strong = describeStrength(checker.check("ladder-pumice-velvet-oasis-cobweb-thicket"));
    expect(strong.score).toBe(4);
    expect(strong.label).toBe("Very strong");
    expect(strong.offline).toMatch(/centuries|years/);
  });
});
