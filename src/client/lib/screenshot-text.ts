import { maxInputLength, qrLabel } from "../../shared/extract";

const maxQrText = 500;

const brokenScheme = /\b(https?):\/(?!\/)/gi;
const unfinishedLink = /[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?[/?=&_-]$/i;
const linkRest = /^[\w%~+#.]*[/?=&_-][\w%~+#./?=&_-]*$/;

function joinWrappedLinks(lines: string[]): string[] {
  const joined: string[] = [];
  for (const line of lines) {
    const previous = joined.at(-1);
    const first = line.split(" ")[0] ?? "";
    if (previous !== undefined && unfinishedLink.test(previous) && linkRest.test(first)) {
      joined[joined.length - 1] = `${previous}${line}`;
    } else {
      joined.push(line);
    }
  }
  return joined;
}

export function cleanReadText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(brokenScheme, "$1://")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim());
  return joinWrappedLinks(lines)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function combineWithReadText(existing: string, read: string, qrTexts: string[]): string {
  const qrLines = qrTexts.map((value) => `${qrLabel}${value.replace(/\s+/g, " ").trim().slice(0, maxQrText)}`);
  const parts = [existing.trim(), cleanReadText(read), ...qrLines].filter((part) => part.length > 0);
  return parts.join("\n\n").slice(0, maxInputLength);
}

export function insertReadText(existing: string, start: number, end: number, read: string, qrTexts: string[]): string {
  const from = Math.max(0, Math.min(start, end, existing.length));
  const to = Math.max(from, Math.min(Math.max(start, end), existing.length));
  const parts = [existing.slice(0, from).trim(), combineWithReadText("", read, qrTexts), existing.slice(to).trim()].filter((part) => part.length > 0);
  return parts.join("\n\n").slice(0, maxInputLength);
}
