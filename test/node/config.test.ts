import assert from "node:assert/strict";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function stripJsonComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

const wrangler = JSON.parse(stripJsonComments(read("wrangler.jsonc"))) as {
  triggers: { crons: string[] };
  workers_dev: boolean;
  preview_urls: boolean;
  routes?: unknown;
};

test("cron triggers in wrangler.jsonc match the maintenance schedule", () => {
  const tasks = read("src/worker/maintenance/tasks.ts");
  const daily = /daily: "([^"]+)"/.exec(tasks)?.[1];
  const weekly = /weekly: "([^"]+)"/.exec(tasks)?.[1];
  assert.deepEqual(wrangler.triggers.crons, [daily, weekly]);
});

test("no public deployment target is configured without approval", () => {
  assert.equal(wrangler.workers_dev, false);
  assert.equal(wrangler.preview_urls, false);
  assert.equal(wrangler.routes, undefined);
});

test("security.txt has the required fields and has not expired", () => {
  const text = read("public/.well-known/security.txt");
  assert.match(text, /^Contact: mailto:\S+@\S+$/m);
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

test("project files contain no em dashes", () => {
  const roots = ["src", "test", "public", "migrations", "docs", ".github"];
  const files = roots.flatMap((root) =>
    (readdirSync(new URL(`../../${root}`, import.meta.url), { recursive: true, withFileTypes: true }) as Dirent[])
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name)),
  );
  const rootFiles = readdirSync(new URL("../../", import.meta.url)).filter((name) => /\.(md|json|jsonc|ts|html)$/.test(name) && !generatedFiles.has(name));
  const offenders = [...files.map((path) => readFileSync(path, "utf8").includes(emDash) ? path : ""),
    ...rootFiles.map((name) => (read(name).includes(emDash) ? name : ""))].filter(Boolean);
  assert.deepEqual(offenders, []);
});
