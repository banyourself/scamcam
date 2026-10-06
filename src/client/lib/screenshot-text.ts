import { maxInputLength } from "../../shared/extract";

const maxQrText = 500;

export function cleanReadText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function combineWithReadText(existing: string, read: string, qrTexts: string[]): string {
  const qrLines = qrTexts.map((value) => `QR code: ${value.replace(/\s+/g, " ").trim().slice(0, maxQrText)}`);
  const parts = [existing.trim(), cleanReadText(read), ...qrLines].filter((part) => part.length > 0);
  return parts.join("\n\n").slice(0, maxInputLength);
}
