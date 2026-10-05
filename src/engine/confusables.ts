const lookalikeLetters: Record<string, string> = {
  "а": "a", "е": "e", "ё": "e", "о": "o", "р": "p", "с": "c", "у": "y",
  "х": "x", "ѕ": "s", "і": "i", "ї": "i", "ј": "j", "ӏ": "l", "ԁ": "d",
  "ԛ": "q", "ԝ": "w", "ү": "y", "һ": "h", "к": "k", "м": "m", "т": "t",
  "в": "b", "н": "h", "ɡ": "g", "ɑ": "a", "ı": "i", "ɩ": "i", "ł": "l",
  "ŀ": "l", "ĸ": "k", "ſ": "s", "α": "a", "ο": "o", "ρ": "p", "ν": "v",
  "κ": "k", "τ": "t", "ι": "i", "υ": "u", "χ": "x", "ϲ": "c", "ε": "e",
  "օ": "o", "ս": "u", "ց": "g", "հ": "h", "ո": "n", "ղ": "n",
};

const lookalikeDigits: Record<string, string> = { "0": "o", "1": "l", "3": "e", "5": "s", "|": "l", i: "l" };

const scriptPatterns: [string, RegExp][] = [
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Armenian", /\p{Script=Armenian}/u],
  ["Han", /\p{Script=Han}/u],
  ["Arabic", /\p{Script=Arabic}/u],
  ["Hebrew", /\p{Script=Hebrew}/u],
];

export function skeleton(text: string): string {
  let result = "";
  for (const char of text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()) {
    result += lookalikeLetters[char] ?? char;
  }
  result = result.replace(/rn/g, "m").replace(/vv/g, "w").replace(/cl/g, "d");
  return [...result].map((char) => lookalikeDigits[char] ?? char).join("");
}

export function scriptsIn(text: string): string[] {
  const found = new Set<string>();
  for (const char of text) {
    for (const [name, pattern] of scriptPatterns) {
      if (pattern.test(char)) {
        found.add(name);
      }
    }
  }
  return [...found];
}

export function hasNonAscii(text: string): boolean {
  return /[^\x00-\x7f]/.test(text);
}

export function editDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  const rows = a.length + 1;
  const columns = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)),
  );
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      let best = Math.min(table[row - 1]![column]! + 1, table[row]![column - 1]! + 1, table[row - 1]![column - 1]! + cost);
      if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
        best = Math.min(best, table[row - 2]![column - 2]! + 1);
      }
      table[row]![column] = best;
    }
  }
  return table[rows - 1]![columns - 1]!;
}
