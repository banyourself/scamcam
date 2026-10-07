export function caseNumber(now: Date): string {
  const date = now.toISOString().slice(2, 10).replaceAll("-", "");
  const random = [...crypto.getRandomValues(new Uint8Array(2))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `SC-${date}-${random.toUpperCase()}`;
}
