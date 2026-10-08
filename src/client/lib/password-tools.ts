import type { ZxcvbnFactory, ZxcvbnResult } from "@zxcvbn-ts/core";

export const strengthLabels = ["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const;
export const effWordCount = 7776;

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: (typeof strengthLabels)[number];
  online: string;
  offline: string;
  warning: string | null;
  suggestions: string[];
}

let checker: Promise<ZxcvbnFactory> | null = null;

export function loadStrengthChecker(): Promise<ZxcvbnFactory> {
  checker ??= Promise.all([import("@zxcvbn-ts/core"), import("@zxcvbn-ts/language-common"), import("@zxcvbn-ts/language-en")]).then(
    ([core, common, english]) =>
      new core.ZxcvbnFactory({
        translations: english.translations,
        graphs: common.adjacencyGraphs,
        dictionary: { ...common.dictionary, ...english.dictionary },
        useLevenshteinDistance: true,
      }),
  );
  checker.catch(() => {
    checker = null;
  });
  return checker;
}

export function describeStrength(result: ZxcvbnResult): Strength {
  return {
    score: result.score,
    label: strengthLabels[result.score],
    online: result.crackTimes.onlineThrottlingXPerHour.display,
    offline: result.crackTimes.offlineFastHashingXPerSecond.display,
    warning: result.feedback.warning,
    suggestions: result.feedback.suggestions,
  };
}

export function randomBelow(limit: number, random: (bytes: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer> = (bytes) => crypto.getRandomValues(bytes)): number {
  const range = 2 ** 32;
  const ceiling = range - (range % limit);
  for (;;) {
    const value = random(new Uint32Array(1))[0]!;
    if (value < ceiling) {
      return value % limit;
    }
  }
}

export interface Passphrase {
  phrase: string;
  bits: number;
}

export function buildPassphrase(words: readonly string[], count: number, separator: string, withExtras: boolean, pick: (limit: number) => number = randomBelow): Passphrase {
  const chosen = Array.from({ length: count }, () => words[pick(words.length)]!);
  let bits = count * Math.log2(words.length);
  if (withExtras) {
    chosen[0] = chosen[0]!.charAt(0).toUpperCase() + chosen[0]!.slice(1);
    chosen.push(String(pick(10)));
    bits += Math.log2(10);
  }
  return { phrase: chosen.join(separator), bits: Math.floor(bits) };
}

let wordlist: Promise<string[]> | null = null;

export function loadWordlist(): Promise<string[]> {
  wordlist ??= import("../data/eff-wordlist").then(({ effLargeWordlist }) => effLargeWordlist.split(" "));
  wordlist.catch(() => {
    wordlist = null;
  });
  return wordlist;
}
