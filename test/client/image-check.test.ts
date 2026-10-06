import { describe, expect, it } from "vitest";
import { checkImageBytes, maxImageBytes } from "../../src/client/lib/image-check";
import { cleanReadText, combineWithReadText } from "../../src/client/lib/screenshot-text";
import { maxInputLength } from "../../src/shared/extract";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? [...part].map((char) => char.charCodeAt(0)) : part)));
const be32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const be16 = (value: number) => [(value >>> 8) & 255, value & 255];
const le16 = (value: number) => [value & 255, (value >>> 8) & 255];
const le24 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255];

const png = (width: number, height: number) => bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), "IHDR", be32(width), be32(height), [8, 6, 0, 0, 0]);
const gif = (width: number, height: number) => bytes("GIF89a", le16(width), le16(height), [0, 0, 0]);
const webpX = (width: number, height: number) => bytes("RIFF", be32(0), "WEBP", "VP8X", le16(10), [0, 0], [0, 0, 0, 0], le24(width - 1), le24(height - 1));
const jpeg = (width: number, height: number, exifBytes = 16) =>
  bytes([0xff, 0xd8], [0xff, 0xe1], be16(exifBytes + 2), new Array<number>(exifBytes).fill(0), [0xff, 0xc0], be16(17), [8], be16(height), be16(width), [3]);

describe("screenshot file checks", () => {
  it.each([
    ["PNG", png(1170, 2532), "png"],
    ["GIF", gif(640, 480), "gif"],
    ["WebP", webpX(1920, 1080), "webp"],
    ["JPEG after EXIF data", jpeg(4032, 3024, 2000), "jpeg"],
  ])("accepts a %s screenshot and reads its size from the header", (_, header, kind) => {
    const result = checkImageBytes(header, 200_000);
    expect(result).toMatchObject({ ok: true, kind });
  });

  it("reads exact dimensions without decoding", () => {
    expect(checkImageBytes(png(1170, 2532), 1000)).toEqual({ ok: true, kind: "png", width: 1170, height: 2532 });
    expect(checkImageBytes(jpeg(4032, 3024), 1000)).toEqual({ ok: true, kind: "jpeg", width: 4032, height: 3024 });
  });

  it.each([
    ["an SVG, which can carry scripts", bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">')],
    ["HTML renamed to .png", bytes("<!doctype html><script>alert(1)</script>")],
    ["a Windows program", bytes("MZ", new Array<number>(64).fill(0))],
    ["a ZIP file", bytes([0x50, 0x4b, 0x03, 0x04], new Array<number>(30).fill(0))],
    ["a PDF", bytes("%PDF-1.7\n")],
    ["plain text", bytes("send me your password")],
    ["HEIC from an iPhone camera", bytes(be32(24), "ftypheic", new Array<number>(16).fill(0))],
  ])("refuses %s, whatever the file name or type says", (_, header) => {
    expect(checkImageBytes(header, header.length)).toMatchObject({ ok: false });
  });

  it.each([
    ["a PNG that claims 50,000 by 50,000 pixels", png(50_000, 50_000)],
    ["a PNG wider than 16,384 pixels", png(20_000, 100)],
    ["a GIF over 40 megapixels", gif(9000, 9000)],
    ["a WebP over 40 megapixels", webpX(16_000, 16_000)],
    ["a JPEG over 40 megapixels", jpeg(10_000, 10_000)],
  ])("refuses %s before the browser decodes it", (_, header) => {
    const result = checkImageBytes(header, 5000);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toContain("too large");
  });

  it.each([
    ["a PNG with no size", png(0, 100)],
    ["a truncated PNG", png(800, 600).subarray(0, 20)],
    ["a JPEG that ends before its size", bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
    ["a JPEG with a broken segment", bytes([0xff, 0xd8, 0x12, 0x34, 0x56, 0x78])],
    ["a JPEG whose image data starts before any size", bytes([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0])],
    ["an empty file", new Uint8Array(0)],
  ])("refuses %s", (_, header) => {
    expect(checkImageBytes(header, header.length).ok).toBe(false);
  });

  it("refuses files over 10 MB without reading further", () => {
    expect(checkImageBytes(png(800, 600), maxImageBytes + 1)).toMatchObject({ ok: false, reason: expect.stringContaining("10 MB") });
  });

  it("survives random bytes without throwing", () => {
    let seed = 7;
    for (let round = 0; round < 500; round += 1) {
      const length = (seed = (seed * 1103515245 + 12345) % 2147483648) % 64;
      const header = Uint8Array.from({ length }, () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 256);
      if (round % 3 === 0 && header.length > 3) {
        header.set([0xff, 0xd8, 0xff]);
      }
      expect(() => checkImageBytes(header, header.length + 1)).not.toThrow();
    }
  });
});

describe("text read from screenshots", () => {
  it("tidies whitespace and blank lines", () => {
    expect(cleanReadText("  hey   bro\r\n\r\n\r\n\r\nsend me\tyour code  \n")).toBe("hey bro\n\nsend me your code");
  });

  it("rejoins links that a chat app wrapped onto two lines and repairs a misread scheme", () => {
    expect(cleanReadText("Free GTA 6 giveaway - rockstargames.com/\ngta6-gift/72618")).toBe("Free GTA 6 giveaway - rockstargames.com/gta6-gift/72618");
    expect(cleanReadText("open (https:/gta2026.net) now")).toBe("open (https://gta2026.net) now");
    expect(cleanReadText("visit steamcommunity.com/\nand log in there")).toBe("visit steamcommunity.com/\nand log in there");
  });

  it("adds the read text and any QR code after what was already typed, within the input limit", () => {
    expect(combineWithReadText("is this real?", "Free nitro at discord-gift.example", ["https://discord-gift.example/claim"])).toBe(
      "is this real?\n\nFree nitro at discord-gift.example\n\nQR code: https://discord-gift.example/claim",
    );
    expect(combineWithReadText("", "x".repeat(maxInputLength * 2), []).length).toBe(maxInputLength);
    expect(combineWithReadText("", "", [`https://a.example/${"y".repeat(2000)}\n<script>`])).toHaveLength(9 + 500);
  });
});
