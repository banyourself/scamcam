import { removeHiddenCharacters, type HiddenCharacters } from "./hidden";

export const maxInputLength = 4000;
export const maxLinks = 20;
export const maxPhones = 5;
export const maxWallets = 5;
export const qrLabel = "QR code: ";

export interface MaskedLink {
  shown: string;
  target: string;
  start: number;
  end: number;
}

const markdownLinkPattern = /\[([^\]\n]{1,300})\]\(\s*<?(https?:\/\/[^\s<>()]+)>?\s*\)/giu;
const slackLinkPattern = /<(https?:\/\/[^\s<>|]+)\|([^<>\n]{1,300})>/giu;

export function maskedLinks(text: string): MaskedLink[] {
  const found: MaskedLink[] = [];
  for (const match of text.matchAll(markdownLinkPattern)) {
    const start = match.index ?? 0;
    found.push({ shown: match[1]!, target: match[2]!, start, end: start + match[0].length });
  }
  for (const match of text.matchAll(slackLinkPattern)) {
    const start = match.index ?? 0;
    found.push({ shown: match[2]!, target: match[1]!, start, end: start + match[0].length });
  }
  return found.sort((a, b) => a.start - b.start);
}

export function qrValues(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith(qrLabel))
    .map((line) => line.slice(qrLabel.length).trim());
}

export function withoutQrLabels(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.startsWith(qrLabel) && !/\s/.test(line.slice(qrLabel.length)) ? line.slice(qrLabel.length) : line))
    .join("\n");
}

export interface Redactions {
  emails: number;
  phoneNumbers: number;
  codes: number;
}

export interface ExtractedInput {
  redactedText: string;
  links: string[];
  phones: string[];
  wallets: string[];
  redactions: Redactions;
  truncated: boolean;
  hidden: Omit<HiddenCharacters, "text">;
}

const emailPattern = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const tokenSeparator = /[\s@]/u;
const phonePattern = /(?<![\p{L}\p{N}/=?&#.-])(?!\d{1,3}(?:\.\d{1,3}){3}(?![\d.]))\+?\d[\d ().-]{7,}\d(?![\p{L}\p{N}])/gu;
const codePattern = /(?<![\p{L}\p{N}/.=-])\d{6,}(?![\p{L}\p{N}])/gu;
const usPhonePattern = /(?<![\p{L}\p{N}/=?&#.+-])(?:\+?1[ .-]?)?\(?([2-9]\d{2})\)?[ .-]?([2-9]\d{2})[ .-]?(\d{4})(?![\p{L}\p{N}])/gu;
const linkPattern =
  /(?:https?:\/\/(?:[^\s/@]+@)?)?(?:(?<![\p{L}\p{N}.])\d{1,3}(?:\.\d{1,3}){3}(?![\p{L}\p{N}.])|(?:[\p{L}\p{N}_](?:[\p{L}\p{N}_-]{0,61}[\p{L}\p{N}_])?\.){1,30}(?:xn--[a-z0-9-]{2,59}|\p{L}{2,63}))(?::\d{2,5})?(?:[/?#][^\s<>"'`[\]|]*)?/giu;
const trailingPunctuation = /[.,;:!?)\]}'"]+$/u;
const walletPattern = /(?<![\p{L}\p{N}])0x[0-9a-fA-F]{40}(?![\p{L}\p{N}])/gu;

function countAndReplace(text: string, pattern: RegExp, replacement: string, keep: (offset: number) => boolean = () => false): [string, number] {
  let count = 0;
  const result = text.replace(pattern, (match: string, offset: number) => {
    if (keep(offset)) {
      return match;
    }
    count += 1;
    return replacement;
  });
  return [result, count];
}

function insideLink(text: string, offset: number): boolean {
  let start = offset;
  while (start > 0 && !tokenSeparator.test(text[start - 1]!)) {
    start -= 1;
  }
  return text.slice(start, offset).includes("://");
}

function hideUsPhones(text: string): [string, string[]] {
  const phones: string[] = [];
  const result = text.replace(usPhonePattern, (match: string, area: string, exchange: string, line: string, offset: number) => {
    if (insideLink(text, offset)) {
      return match;
    }
    phones.push(`+1${area}${exchange}${line}`);
    return "[number hidden]";
  });
  return [result, phones];
}

export function extractInput(rawText: string): ExtractedInput {
  const truncated = rawText.length > maxInputLength;
  const { text: visible, ...hidden } = removeHiddenCharacters(rawText.slice(0, maxInputLength));
  const text = visible.normalize("NFC");
  const [withoutEmails, emails] = countAndReplace(text, emailPattern, "[email hidden]", (offset) => insideLink(text, offset));
  const [withoutUsPhones, usPhones] = hideUsPhones(withoutEmails);
  const [withoutCodes, codes] = countAndReplace(withoutUsPhones, codePattern, "[code hidden]");
  const [redactedText, otherPhones] = countAndReplace(withoutCodes, phonePattern, "[number hidden]");
  const phoneNumbers = usPhones.length + otherPhones;
  const phones = [...new Set(usPhones)].slice(0, maxPhones);

  const links: string[] = [];
  for (const match of redactedText.matchAll(linkPattern)) {
    const link = match[0].replace(trailingPunctuation, "");
    if (link.length > 3 && !links.includes(link)) {
      links.push(link);
    }
    if (links.length >= maxLinks) {
      break;
    }
  }

  const wallets = [...new Set([...redactedText.matchAll(walletPattern)].map((match) => match[0].toLowerCase()))].slice(0, maxWallets);

  return { redactedText, links, phones, wallets, redactions: { emails, phoneNumbers, codes }, truncated, hidden };
}
