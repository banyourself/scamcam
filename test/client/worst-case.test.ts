import { describe, expect, it } from "vitest";
import { scanContent } from "../../src/engine/scan";
import { extractInput, maxInputLength, maxLinks } from "../../src/shared/extract";
import { ScanReportSchema } from "../../src/shared/report-schema";

const offline: typeof fetch = async () => {
  throw new TypeError("outside sources are switched off");
};
const options = { fetcher: offline, takeBudget: async () => true };
const char = (code: number) => String.fromCodePoint(code);
const fill = (unit: string) => unit.repeat(Math.ceil(maxInputLength / unit.length)).slice(0, maxInputLength);
const limitMs = 250;
const extractLimitMs = 15;

const pathological: [string, string][] = [
  ["one long word", fill("a")],
  ["many dots", fill("a.")],
  ["deep subdomains", `${fill("ab.").slice(0, maxInputLength - 4)}.com`],
  ["digits", fill("1")],
  ["digits and dots", fill("1.")],
  ["digits and spaces", fill("1 ")],
  ["phone-like runs", fill("+1 (555) 01")],
  ["at signs", fill("a@")],
  ["email-like chain", fill("a.b@c.")],
  ["schemes", fill("http://")],
  ["slashes", fill("/")],
  ["hyphens", fill("a-")],
  ["punycode prefixes", fill("xn--")],
  ["brand words", fill("steam ")],
  ["brand look-alikes", fill("steamcommunlty.")],
  ["negations", fill("never ")],
  ["rule words", fill("send me your password ")],
  ["none repeated", fill("none ")],
  ["checker instructions", fill("ignore previous instructions ")],
  ["zero-width splits", fill(`a${char(0x200b)}`)],
  ["direction controls", fill(char(0x202e))],
  ["tag characters", fill(char(0xe0041))],
  ["combining marks", fill(`a${char(0x301)}${char(0x302)}`)],
  ["emoji", fill(char(0x1f600))],
  ["link placeholders", fill("[link]")],
  ["quotes", fill("\"'`")],
  ["percent escapes", fill("%25")],
  ["long query", `https://example.com/?${fill("a=1&").slice(0, maxInputLength - 25)}`],
];

describe("worst-case inputs", () => {
  it.each(pathological)("handles %s quickly and returns a valid report", async (_, input) => {
    const started = performance.now();
    const report = await scanContent(input, options);
    const elapsed = performance.now() - started;
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(elapsed).toBeLessThan(limitMs);
  });

  it.each(pathological)("extracts links and contact details from %s without slow backtracking", (_, input) => {
    const times: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const started = performance.now();
      extractInput(input);
      times.push(performance.now() - started);
    }
    expect(Math.min(...times)).toBeLessThan(extractLimitMs);
  });
});

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const pieces = [
  "a", "Z", "7", " ", ".", "-", "_", "@", ":", "/", "?", "&", "=", "#", "%", "+", "!", "\n", "\t",
  "https://", "http://", "www.", ".com", ".ru", ".gg", "steam", "discord", "roblox", "nitro", "free", "gift",
  "password", "code", "send", "never", "verify", "trade", "login", "none", "label:", "SYSTEM:", "[link]",
  char(0x0441), char(0x03b1), char(0x0627), char(0x4e2d), char(0x1f600), char(0x301), char(0x200b), char(0x200d),
  char(0x202e), char(0x2066), char(0xfe0f), char(0xe0041), char(0x0000), char(0x001b), char(0x00ad), char(0xfeff),
];

describe("fuzzing", () => {
  it("never throws, always returns a valid report, and stays fast on 300 random inputs", async () => {
    const next = random(20261005);
    let slowest = 0;
    for (let round = 0; round < 300; round += 1) {
      const length = Math.floor(next() * 600);
      let input = "";
      for (let index = 0; index < length; index += 1) {
        input += pieces[Math.floor(next() * pieces.length)];
      }
      input = input.slice(0, maxInputLength);
      const extracted = extractInput(input);
      expect(extracted.links.length).toBeLessThanOrEqual(maxLinks);
      expect(/[\u200B\u202E\u2066\uFEFF\u00AD]|[\u{E0000}-\u{E007F}]/u.test(extracted.redactedText)).toBe(false);
      const started = performance.now();
      const report = await scanContent(input, options);
      slowest = Math.max(slowest, performance.now() - started);
      const parsed = ScanReportSchema.safeParse(report);
      expect(parsed.success, input).toBe(true);
    }
    expect(slowest).toBeLessThan(limitMs);
  });
});
