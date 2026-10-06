import assert from "node:assert/strict";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function stripJsonComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

const wrangler = JSON.parse(stripJsonComments(read("wrangler.jsonc"))) as {
  triggers: { crons: string[] };
  workers_dev: boolean;
  preview_urls: boolean;
  routes?: unknown;
  observability?: { enabled?: boolean; logs?: { enabled?: boolean; invocation_logs?: boolean } };
};

test("cron triggers in wrangler.jsonc match the maintenance schedule", () => {
  const tasks = read("src/worker/maintenance/tasks.ts");
  const daily = /daily: "([^"]+)"/.exec(tasks)?.[1];
  const weekly = /weekly: "([^"]+)"/.exec(tasks)?.[1];
  assert.deepEqual(wrangler.triggers.crons, [daily, weekly]);
});

test("Workers Logs keep only ScamCam's own events, not Cloudflare's per-request records", () => {
  assert.equal(wrangler.observability?.enabled, true);
  assert.equal(wrangler.observability?.logs?.enabled, true);
  assert.equal(wrangler.observability?.logs?.invocation_logs, false);
});

test("no public deployment target is configured without approval", () => {
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);
  assert.equal(wrangler.routes, undefined);
});

test("security.txt has the required fields and has not expired", () => {
  const text = read("public/.well-known/security.txt");
  assert.match(text, /^Contact: mailto:\S+@\S+$/m);
  assert.match(text, /^Policy: https:\/\/scamcam\.kevinle\.tech\/disclosure$/m);
  const expires = /^Expires: (\S+)$/m.exec(text)?.[1];
  assert.ok(expires, "Expires is required");
  const days = (Date.parse(expires) - Date.now()) / 86_400_000;
  assert.ok(days > 30, `security.txt expires in ${Math.round(days)} days; renew it`);
  assert.ok(days < 366, "Expires should be less than a year away");
});

test("static pages send a strict content security policy", () => {
  const headers = read("public/_headers");
  for (const required of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'"]) {
    assert.ok(headers.includes(required), `missing ${required}`);
  }
  assert.ok(!headers.includes("unsafe-inline"));
  assert.ok(!headers.includes("unsafe-eval"));
});

const emDash = String.fromCharCode(0x2014);
const generatedFiles = new Set(["worker-configuration.d.ts", "package-lock.json"]);

function projectFiles(): string[] {
  const roots = ["src", "test", "public", "migrations", "docs", ".github", "scripts"];
  const files = roots.flatMap((root) =>
    (readdirSync(new URL(`../../${root}`, import.meta.url), { recursive: true, withFileTypes: true }) as Dirent[])
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name)),
  );
  const rootFiles = readdirSync(new URL("../../", import.meta.url))
    .filter((name) => /\.(md|json|jsonc|ts|html)$/.test(name) && !generatedFiles.has(name))
    .map((name) => fileURLToPath(new URL(`../../${name}`, import.meta.url)));
  return [...files, ...rootFiles];
}

test("project files contain no em dashes", () => {
  const offenders = projectFiles().filter((path) => readFileSync(path, "utf8").includes(emDash));
  assert.deepEqual(offenders, []);
});

const invisibleRanges: [number, number][] = [
  [0x00ad, 0x00ad],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0xfeff, 0xfeff],
  [0xe0000, 0xe007f],
];

function hasInvisibleCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (invisibleRanges.some(([low, high]) => code >= low && code <= high)) {
      return true;
    }
  }
  return false;
}

test("project files contain no raw invisible or text direction characters", () => {
  const offenders = projectFiles().filter((path) => hasInvisibleCharacter(readFileSync(path, "utf8")));
  assert.deepEqual(offenders, []);
});

test("every GitHub Action is pinned to a full commit", () => {
  for (const workflow of readdirSync(new URL("../../.github/workflows/", import.meta.url))) {
    for (const line of read(`.github/workflows/${workflow}`).split("\n")) {
      const used = /^\s*-?\s*uses:\s*(\S+)/.exec(line)?.[1];
      if (used) {
        assert.match(used, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${workflow}: ${used} is not pinned to a commit`);
      }
    }
  }
});
