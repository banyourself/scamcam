export const passwordPrefixPattern = /^[0-9A-F]{5}$/;
export const pwnedPasswordsPage = "https://haveibeenpwned.com/Passwords";

const rangeLine = /^([0-9A-F]{35}):(\d{1,12})$/;

export function isRangeBody(body: string): boolean {
  const lines = body.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  return lines.length > 0 && lines.every((line) => rangeLine.test(line));
}

export function rangeCounts(body: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of body.split("\n")) {
    const match = rangeLine.exec(line.trim());
    const count = match ? Number(match[2]) : 0;
    if (match && count > 0) {
      counts.set(match[1]!, count);
    }
  }
  return counts;
}
