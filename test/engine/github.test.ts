import { describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { answerFrom, githubApiBase } from "../../src/engine/github";
import { scanContent, type ScanOptions } from "../../src/engine/scan";
import { analyzeLink } from "../../src/engine/url-analysis";
import { ScanReportSchema } from "../../src/shared/report-schema";
import { allowAllBudgets, fakeNetwork, type FakeNetworkOptions } from "./fake-network";

const now = new Date("2026-10-08T12:00:00.000Z");
const githubToken = "github-test-token-value";

function scanner(network: FakeNetworkOptions = {}, extra: Partial<ScanOptions> = {}) {
  const fake = fakeNetwork({ now, ...network });
  const scan: ScanOptions = { fetcher: fake.fetcher, takeBudget: allowAllBudgets, now, extendedLookups: true, githubToken, ...extra };
  return { fake, scan };
}

function githubCalls(requests: { url: string }[]): string[] {
  return requests.filter((request) => request.url.startsWith(githubApiBase)).map((request) => request.url.slice(githubApiBase.length));
}

describe("reading GitHub links", () => {
  it.each([
    ["https://github.com/someone/cool-game", { owner: "someone", repo: "cool-game" }],
    ["https://www.github.com/someone/cool-game.git", { owner: "someone", repo: "cool-game" }],
    ["https://github.com/someone/cool-game/releases/download/v1/Setup.exe", { owner: "someone", repo: "cool-game" }],
    ["https://raw.githubusercontent.com/someone/tools/main/run.ps1", { owner: "someone", repo: "tools" }],
    ["https://codeload.github.com/someone/tools/zip/refs/heads/main", { owner: "someone", repo: "tools" }],
    ["https://github.com/someone", { owner: "someone", repo: null }],
    ["https://someone.github.io/free-nitro/", { owner: "someone", repo: null }],
  ])("reads %s", (link, ref) => {
    expect(analyzeLink(link).githubRef).toEqual(ref);
  });

  it.each([
    "https://github.com/settings/tokens",
    "https://github.com/orgs/someone/repositories",
    "https://github.com/marketplace/actions/x",
    "https://github.com/",
    "https://gist.github.com/someone/abc123",
    "https://raw.githubusercontent.com/someone",
    "https://github.com/-bad-/repo",
    "https://github.com/someone/..",
    "https://github-downloads.example/someone/cool-game",
    "https://objects.githubusercontent.com/github-production-release-asset/1",
  ])("finds no repository or account in %s", (link) => {
    expect(analyzeLink(link).githubRef).toBeNull();
  });

  it("refuses answers it cannot read instead of guessing", () => {
    expect(answerFrom({ owner: "someone", repo: "x" }, { status: 200, body: {} }, { status: 200, body: { login: "someone", type: "User", created_at: "2020-01-01T00:00:00Z" } })).toBeNull();
    expect(answerFrom({ owner: "someone", repo: "x" }, { status: 403, body: { message: "API rate limit exceeded" } }, { status: 403, body: null })).toBeNull();
    expect(answerFrom({ owner: "someone", repo: null }, null, null)).toBeNull();
  });
});

describe("GitHub repository facts in scans", () => {
  it("describes an established repository as context only, sending GitHub only the owner and name with the token", async () => {
    const { scan, fake } = scanner({ githubRepos: { "someone/cool-game": { createdDaysAgo: 2400, stars: 1234, forks: 56 } }, githubUsers: { someone: { createdDaysAgo: 3000 } } });
    const plain = await scanContent("https://github.com/someone/cool-game", { ...scan, githubToken: undefined });
    const report = await scanContent("https://github.com/someone/cool-game", scan);
    expect(ScanReportSchema.safeParse(report).success).toBe(true);
    expect(report.level).toBe(plain.level);
    const facts = report.evidence.find((item) => item.id === "github-repo-someone/cool-game");
    expect(facts).toMatchObject({ signal: "neutral", source: { name: "GitHub repository details", url: "https://docs.github.com/en/rest/repos/repos#get-a-repository" } });
    expect(facts?.title).toBe("GitHub shows someone/cool-game was made in March 2020, with 1,234 stars and 56 forks");
    expect(facts?.detail).toContain("The account that owns it was made in July 2018.");
    expect(report.evidence.some((item) => item.id.startsWith("github-") && item.signal === "lowers_risk")).toBe(false);
    expect(githubCalls(fake.requests).sort()).toEqual(["repos/someone/cool-game", "users/someone"]);
    for (const request of fake.requests) {
      const sendsToken = request.headers.get("Authorization") === `Bearer ${githubToken}`;
      expect(sendsToken).toBe(request.url.startsWith(githubApiBase));
      expect(request.url.includes(githubToken) || request.body.includes(githubToken)).toBe(false);
    }
    const github = fake.requests.find((request) => request.url.startsWith(githubApiBase))!;
    expect(github.headers.get("X-GitHub-Api-Version")).toBe("2026-03-10");
    expect(github.headers.get("User-Agent")).toBe("ScamCam (https://scamcam.kevinle.tech)");
    expect(JSON.stringify(report)).not.toContain("never shown");
  });

  it("treats a brand-new owner or repository as a weak sign only", async () => {
    const newOwner = scanner({ githubRepos: { "fresh/aimbot": { createdDaysAgo: 2 } }, githubUsers: { fresh: { createdDaysAgo: 5 } } });
    const report = await scanContent("https://github.com/fresh/aimbot/releases", newOwner.scan);
    expect(report.evidence.find((item) => item.id === "github-new-fresh/aimbot")).toMatchObject({ signal: "raises_risk", title: "The GitHub account that owns this repository was made 5 days ago" });
    expect(["unknown", "no_known_threat"]).toContain(report.level);
    const newRepo = scanner({ githubRepos: { "veteran/tool": { createdDaysAgo: 3 } }, githubUsers: { veteran: { createdDaysAgo: 3000 } } });
    expect((await scanContent("https://github.com/veteran/tool", newRepo.scan)).evidence.find((item) => item.id === "github-new-veteran/tool")?.title).toBe("This GitHub repository was made 3 days ago");
  });

  it("warns more about a repository GitHub blocked or removed", async () => {
    const blocked = await scanContent("https://github.com/leaker/game-source", scanner({ githubRepos: { "leaker/game-source": 451 }, githubUsers: { leaker: {} } }).scan);
    expect(blocked.evidence.find((item) => item.id === "github-blocked-leaker/game-source")).toMatchObject({ signal: "raises_risk", title: "GitHub has blocked access to this repository" });
    const removed = await scanContent("https://github.com/someone/free-robux", scanner({ githubUsers: { someone: {} } }).scan);
    expect(removed.evidence.find((item) => item.id === "github-missing-someone/free-robux")?.title).toBe("GitHub has no public repository at this address");
    const gone = await scanContent("https://github.com/banned-user/stealer", scanner().scan);
    expect(gone.evidence.find((item) => item.id === "github-missing-banned-user/stealer")?.title).toBe("This GitHub account does not exist");
    const message = "bro test my new game, download it here https://github.com/banned-user/stealer/releases";
    const withMessage = await scanContent(message, scanner().scan);
    const without = await scanContent(message, { ...scanner().scan, githubToken: undefined });
    expect(["suspicious", "high_risk"]).toContain(withMessage.level);
    expect(["suspicious", "high_risk"]).toContain(without.level);
  });

  it("describes accounts behind profile and GitHub Pages links, and notes archived repositories", async () => {
    const { scan, fake } = scanner({ githubUsers: { someone: { createdDaysAgo: 9 }, oldorg: { createdDaysAgo: 4000, type: "Organization" } }, githubRepos: { "oldorg/legacy": { archived: true } } });
    expect((await scanContent("https://someone.github.io/claim-nitro", scan)).evidence.find((item) => item.id === "github-new-someone")?.title).toBe("This GitHub account was made 9 days ago");
    expect(githubCalls(fake.requests)).toEqual(["users/someone"]);
    expect((await scanContent("https://github.com/oldorg", scan)).evidence.find((item) => item.id === "github-account-oldorg")?.title).toBe("This GitHub organization was made in October 2015");
    const archived = await scanContent("https://github.com/oldorg/legacy", scan);
    expect(archived.evidence.map((item) => item.id)).toContain("github-archived-oldorg/legacy");
    expect((await scanContent("https://github.com/nobody-here", scan)).evidence.find((item) => item.id === "github-missing-nobody-here")).toMatchObject({ signal: "raises_risk" });
  });

  it("says when GitHub is not connected or did not answer, and asks nothing without a token", async () => {
    const off = scanner({}, { githubToken: undefined });
    const report = await scanContent("https://github.com/someone/cool-game", off.scan);
    expect(report.notChecked).toContainEqual({ name: "GitHub repository details", reason: "not_configured" });
    expect(githubCalls(off.fake.requests)).toEqual([]);
    const limited = await scanContent("https://github.com/someone/cool-game", scanner({ githubStatus: 403 }).scan);
    expect(limited.notChecked).toContainEqual({ name: "GitHub repository details", reason: "unavailable" });
    expect(limited.evidence.some((item) => item.id.startsWith("github-"))).toBe(false);
  });

  it("looks up one GitHub link per scan, only in the scanner, and remembers the answer", async () => {
    const network: FakeNetworkOptions = { githubRepos: { "a/one": {}, "b/two": {} }, githubUsers: { a: {}, b: {} } };
    const lookups = memoryLookups(() => now.getTime());
    const first = scanner(network, { lookups });
    await scanContent("https://github.com/a/one and https://github.com/b/two", first.scan);
    expect(githubCalls(first.fake.requests)).toHaveLength(2);
    const repeat = scanner(network, { lookups });
    await scanContent("https://github.com/a/one and https://github.com/b/two", repeat.scan);
    expect(githubCalls(repeat.fake.requests)).toEqual([]);
    const worker = scanner(network, { extendedLookups: false });
    await scanContent("https://github.com/a/one", worker.scan);
    expect(githubCalls(worker.fake.requests)).toEqual([]);
  });
});
