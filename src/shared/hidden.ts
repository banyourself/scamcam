export interface HiddenCharacters {
  text: string;
  inWords: number;
  inLinks: number;
  direction: number;
  smuggled: number;
}

const invisible = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFE00-\uFE0F\uFEFF\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
const directionControls = /[\u202A-\u202E\u2066-\u2069]/gu;
const flagSequence = /\u{1F3F4}[\u{E0061}-\u{E007A}]{2,7}\u{E007F}/gu;
const smuggling = /[\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]|[\uFE00-\uFE0F]{2,}/gu;
const splitWord = /[\p{L}\p{N}][\u00AD\u180E\u200B\u2060-\u2064\uFEFF]+(?=[\p{L}\p{N}.])|[A-Za-z0-9][\u200C]+(?=[A-Za-z0-9])/gu;
const domainLike = /[\p{L}\p{N}-]+\.[\p{L}]{2,}/u;

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function removeHiddenCharacters(original: string): HiddenCharacters {
  const withoutFlags = original.replace(flagSequence, "\u{1F3F4}");
  let inLinks = 0;
  for (const token of withoutFlags.split(/\s+/)) {
    const cleaned = token.replace(invisible, "");
    if (cleaned !== token && count(token, splitWord) > 0 && domainLike.test(cleaned)) {
      inLinks += 1;
    }
  }
  return {
    text: withoutFlags.replace(invisible, ""),
    inWords: count(withoutFlags, splitWord),
    inLinks,
    direction: count(withoutFlags, directionControls),
    smuggled: count(withoutFlags, smuggling),
  };
}
