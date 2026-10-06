export const maxImageBytes = 10 * 1024 * 1024;
export const maxImagePixels = 40_000_000;
export const maxImageSide = 16_384;
export const imageHeaderBytes = 512 * 1024;
export const acceptedImageTypes = "image/png,image/jpeg,image/webp,image/gif";

export class ScreenshotError extends Error {}

export type ImageKind = "png" | "jpeg" | "webp" | "gif";

export type ImageCheck =
  | { ok: true; kind: ImageKind; width: number; height: number }
  | { ok: false; reason: string };

const notAnImage = "Only PNG, JPEG, WebP, and GIF screenshots can be read. Save the screenshot in one of those formats and try again.";
const unreadable = "This image could not be read. Take a new screenshot and try again.";

function matches(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return bytes.length < offset + length ? "" : String.fromCharCode(...bytes.subarray(offset, offset + length));
}

const u16be = (bytes: Uint8Array, offset: number) => (bytes[offset]! << 8) | bytes[offset + 1]!;
const u16le = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8);
const u24le = (bytes: Uint8Array, offset: number) => bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
const u32be = (bytes: Uint8Array, offset: number) => ((bytes[offset]! << 24) >>> 0) + ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!);

function kindOf(bytes: Uint8Array): ImageKind | null {
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (matches(bytes, [0xff, 0xd8, 0xff])) {
    return "jpeg";
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "webp";
  }
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") {
    return "gif";
  }
  return null;
}

function pngSize(bytes: Uint8Array): [number, number] | null {
  return bytes.length >= 24 && ascii(bytes, 12, 4) === "IHDR" ? [u32be(bytes, 16), u32be(bytes, 20)] : null;
}

function gifSize(bytes: Uint8Array): [number, number] | null {
  return bytes.length >= 10 ? [u16le(bytes, 6), u16le(bytes, 8)] : null;
}

function webpSize(bytes: Uint8Array): [number, number] | null {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 " && bytes.length >= 30 && matches(bytes, [0x9d, 0x01, 0x2a], 23)) {
    return [u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff];
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const [b0, b1, b2, b3] = [bytes[21]!, bytes[22]!, bytes[23]!, bytes[24]!];
    return [1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))];
  }
  if (chunk === "VP8X" && bytes.length >= 30) {
    return [1 + u24le(bytes, 24), 1 + u24le(bytes, 27)];
  }
  return null;
}

const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const standalone = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]);

function jpegSize(bytes: Uint8Array): [number, number] | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    let marker = bytes[offset + 1]!;
    while (marker === 0xff && offset + 2 < bytes.length) {
      offset += 1;
      marker = bytes[offset + 1]!;
    }
    if (standalone.has(marker)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    const length = u16be(bytes, offset + 2);
    if (length < 2) {
      return null;
    }
    if (startOfFrame.has(marker)) {
      return offset + 9 <= bytes.length ? [u16be(bytes, offset + 7), u16be(bytes, offset + 5)] : null;
    }
    offset += 2 + length;
  }
  return null;
}

export function checkImageBytes(header: Uint8Array, size: number): ImageCheck {
  if (size === 0) {
    return { ok: false, reason: unreadable };
  }
  if (size > maxImageBytes) {
    return { ok: false, reason: "This image is larger than 10 MB. Crop the screenshot to the message and try again." };
  }
  const kind = kindOf(header);
  if (!kind) {
    return { ok: false, reason: notAnImage };
  }
  const dimensions = { png: pngSize, gif: gifSize, webp: webpSize, jpeg: jpegSize }[kind](header);
  if (!dimensions) {
    return { ok: false, reason: unreadable };
  }
  const [width, height] = dimensions;
  if (width < 1 || height < 1) {
    return { ok: false, reason: unreadable };
  }
  if (width > maxImageSide || height > maxImageSide || width * height > maxImagePixels) {
    return { ok: false, reason: "This image is too large to read safely. Crop the screenshot to the message and try again." };
  }
  return { ok: true, kind, width, height };
}
