export const maxInputLength = 4000;
export const maxLinks = 20;

export interface Redactions {
  emails: number;
  phoneNumbers: number;
  codes: number;
}

export interface ExtractedInput {
  redactedText: string;
  links: string[];
  redactions: Redactions;
  truncated: boolean;
}

const emailPattern = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const phonePattern = /(?<![\p{L}\p{N}/=?&#.-])\+?\d[\d ().-]{7,}\d(?![\p{L}\p{N}])/gu;
const codePattern = /(?<![\p{L}\p{N}/.=-])\d{6,}(?![\p{L}\p{N}])/gu;
const linkPattern =
  /(?:https?:\/\/)?(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:xn--[a-z0-9-]{2,59}|\p{L}{2,63})(?::\d{2,5})?(?:[/?#][^\s<>"'`]*)?/giu;
const trailingPunctuation = /[.,;:!?)\]}'"]+$/u;

function countAndReplace(text: string, pattern: RegExp, replacement: string): [string, number] {
  let count = 0;
  const result = text.replace(pattern, () => {
    count += 1;
    return replacement;
  });
  return [result, count];
}

export function extractInput(rawText: string): ExtractedInput {
  const truncated = rawText.length > maxInputLength;
  const text = rawText.slice(0, maxInputLength).normalize("NFC");
  const [withoutEmails, emails] = countAndReplace(text, emailPattern, "[email hidden]");
  const [withoutCodes, codes] = countAndReplace(withoutEmails, codePattern, "[code hidden]");
  const [redactedText, phoneNumbers] = countAndReplace(withoutCodes, phonePattern, "[number hidden]");

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

  return { redactedText, links, redactions: { emails, phoneNumbers, codes }, truncated };
}
