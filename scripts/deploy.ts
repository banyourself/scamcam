import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

interface ProductionConfig {
  name?: string;
  routes?: unknown;
  d1_databases?: { database_id?: string }[];
  vars?: Record<string, string>;
}

const root = resolve(import.meta.dirname, "..");
const bin = (...parts: string[]) => join(root, "node_modules", ...parts);
const { values } = parseArgs({ options: { "dry-run": { type: "boolean", default: false } } });
const dryRun = values["dry-run"] ?? false;
const testSiteKey = /^[123]x0{20}[A-F]{2}$/;
const databaseId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const expectedRoutes = JSON.stringify([{ pattern: "scamcam.kevinle.tech", custom_domain: true }]);
const redirect = join(root, ".wrangler", "deploy", "config.json");

function step(label: string, script: string, args: string[], env: Record<string, string> = {}): void {
  console.log(`\n> ${label}`);
  execFileSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function configProblems(production: ProductionConfig | undefined): string[] {
  if (!production) {
    return ["wrangler.jsonc has no production environment"];
  }
  const problems: string[] = [];
  const id = production.d1_databases?.[0]?.database_id ?? "";
  if (!databaseId.test(id) || id.startsWith("00000000")) {
    problems.push("the production D1 database ID is not set");
  }
  const siteKey = production.vars?.TURNSTILE_SITE_KEY ?? "";
  if (siteKey === "" || siteKey.startsWith("PENDING") || testSiteKey.test(siteKey)) {
    problems.push("the production Turnstile site key is not set, or is a test key");
  }
  if (production.name !== "scamcam" || JSON.stringify(production.routes) !== expectedRoutes) {
    problems.push("production must be the scamcam Worker on scamcam.kevinle.tech only");
  }
  return problems;
}

function gitProblems(): string[] {
  const problems: string[] = [];
  if (git(["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") {
    problems.push("not on the main branch");
  }
  if (git(["status", "--porcelain"]) !== "") {
    problems.push("there are uncommitted changes");
  }
  git(["fetch", "--quiet", "origin", "main"]);
  if (git(["rev-parse", "HEAD"]) !== git(["rev-parse", "origin/main"])) {
    problems.push("local main differs from GitHub; push or pull first");
  }
  return problems;
}

function main(): void {
  const config = JSON.parse(readFileSync(join(root, "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, "")) as {
    env?: { production?: ProductionConfig };
  };
  const problems = [...configProblems(config.env?.production), ...gitProblems()];
  if (problems.length > 0) {
    const list = problems.map((problem) => `- ${problem}`).join("\n");
    if (!dryRun) {
      console.error(`Not deploying:\n${list}`);
      process.exitCode = 1;
      return;
    }
    console.warn(`A real deploy would stop here:\n${list}\nContinuing because this is a dry run.`);
  }
  try {
    step("Type check", bin("typescript", "bin", "tsc"), ["-b"]);
    step("Tests", bin("vitest", "vitest.mjs"), ["run"], { SCAMCAM_LOCAL_ONLY: "1" });
    step("Config tests", "--test", ["test/node/*.test.ts"]);
    step("Production build", bin("vite", "bin", "vite.js"), ["build"], { CLOUDFLARE_ENV: "production", SCAMCAM_LOCAL_ONLY: "1" });
    const built = JSON.parse(readFileSync(join(root, "dist", "scamcam", "wrangler.json"), "utf8")) as ProductionConfig;
    if (built.name !== "scamcam" || JSON.stringify(built.routes) !== expectedRoutes || built.vars?.APP_ENV !== "production") {
      throw new Error("The production build did not use the production settings");
    }
    step("Pack the browser extension", join(root, "scripts", "pack-extension.mjs"), []);
    step(dryRun ? "Deploy (dry run, nothing is uploaded)" : "Deploy", bin("wrangler", "bin", "wrangler.js"), dryRun ? ["deploy", "--dry-run"] : ["deploy"]);
    console.log(dryRun ? "\nDry run finished. Nothing was deployed." : "\nDeployed. Next: npm run check:live");
  } finally {
    if (existsSync(redirect)) {
      rmSync(redirect);
    }
  }
}

main();
