import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const repository = "disposable-email-domains/disposable-email-domains";
export const listPath = "disposable_email_blocklist.conf";
export const outputPath = "src/engine/data/disposable-domains.ts";
const userAgent = "ScamCam list build (+https://scamcam.kevinle.tech)";
const domainPattern = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;
const minimum = 3000;
const maximum = 100_000;
export const neverDisposable = ["gmail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com"];

export function parseList(text: string): string[] {
  const domains = new Set<string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim().toLowerCase();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (!domainPattern.test(line)) {
      throw new Error(`not a domain: ${line.slice(0, 80)}`);
    }
    domains.add(line);
  }
  const sorted = [...domains].sort();
  if (sorted.length < minimum || sorted.length > maximum) {
    throw new Error(`expected ${minimum} to ${maximum} domains, found ${sorted.length}`);
  }
  const wrong = neverDisposable.filter((domain) => domains.has(domain));
  if (wrong.length > 0) {
    throw new Error(`the list includes real email providers: ${wrong.join(", ")}`);
  }
  return sorted;
}

export function moduleFor(domains: string[], commit: string, date: string): string {
  if (!/^[0-9a-f]{40}$/.test(commit) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("bad commit or date");
  }
  return [
    `export const disposableListCommit = "${commit}";`,
    `export const disposableListDate = "${date}";`,
    `export const disposableDomainList = "${domains.join(" ")}";`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const headers = { "User-Agent": userAgent, Accept: "application/vnd.github+json" };
  const commits = await fetch(`https://api.github.com/repos/${repository}/commits?path=${listPath}&per_page=1`, { headers });
  if (!commits.ok) {
    throw new Error(`GitHub answered ${commits.status}`);
  }
  const [latest] = (await commits.json()) as { sha: string; commit: { committer: { date: string } } }[];
  if (!latest) {
    throw new Error("no commit found");
  }
  const raw = await fetch(`https://raw.githubusercontent.com/${repository}/${latest.sha}/${listPath}`, { headers: { "User-Agent": userAgent } });
  if (!raw.ok) {
    throw new Error(`the list download answered ${raw.status}`);
  }
  const domains = parseList(await raw.text());
  writeFileSync(outputPath, moduleFor(domains, latest.sha, latest.commit.committer.date.slice(0, 10)));
  console.log(`${domains.length} disposable email domains from ${repository} at ${latest.sha.slice(0, 12)} written to ${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
