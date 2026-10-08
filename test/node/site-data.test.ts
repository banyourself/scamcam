import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  buildNotices,
  buildSiteSecurity,
  californiaNotices,
  minimums,
  pack,
  parseCsv,
  partLength,
  safeUrl,
  sqlFor,
  washingtonNotices,
} from "../../scripts/site-data.ts";

const builtAt = new Date("2026-10-08T23:00:00.000Z");

function filler(count: number, make: (index: number) => unknown): Record<string, unknown> {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`site-${index}.example`, make(index)]));
}

const twoFactor = {
  ...filler(minimums.twoFactor, () => ({})),
  "discord.com": { methods: ["sms", "totp", "u2f"], documentation: "https://support.discord.com/hc/en-us/articles/219576828" },
  "epicgames.com": { methods: ["email", "custom-software"], "custom-software": ["Epic Games app"], notes: "Line one.\n\nLine\u0007two." },
  "bad.example": { methods: ["totp"], documentation: "javascript:alert(1)", recovery: "http://bad.example/" },
  "Not A Domain": { methods: ["totp"] },
};
const passkeys = {
  ...filler(minimums.passkeys, () => ({ passwordless: "allowed" })),
  "discord.com": { passwordless: "allowed", documentation: "https://support.discord.com/hc/articles/25966860846231" },
  "roblox.com": { mfa: "allowed", contact: { twitter: "x" } },
  "contact-only.example": { contact: { twitter: "x" } },
};
const changePassword = { ...Object.fromEntries(Array.from({ length: minimums.changePassword }, (_, index) => [`cp-${index}.example`, `https://cp-${index}.example/password`])), "google.com": "https://myaccount.google.com/signinoptions/password", "evil.example": "https://user:pass@evil.example/" };

test("site security merges the three sources by domain and drops anything unsafe", () => {
  const data = buildSiteSecurity(twoFactor, passkeys, changePassword, builtAt);
  const site = (domain: string) => data.sites.find((entry) => entry.d === domain);
  assert.deepEqual(site("discord.com"), { d: "discord.com", m: 1 + 2 + 16, doc: "https://support.discord.com/hc/en-us/articles/219576828", pk: 1, pkDoc: "https://support.discord.com/hc/articles/25966860846231" });
  assert.deepEqual(site("epicgames.com"), { d: "epicgames.com", m: 4 + 64, sw: ["Epic Games app"], note: "Line one. Line two." });
  assert.deepEqual(site("bad.example"), { d: "bad.example", m: 1 });
  assert.deepEqual(site("roblox.com"), { d: "roblox.com", pk: 2 });
  assert.deepEqual(site("google.com"), { d: "google.com", cp: "https://myaccount.google.com/signinoptions/password" });
  assert.equal(site("contact-only.example"), undefined);
  assert.equal(site("not a domain"), undefined);
  assert.equal(site("evil.example"), undefined);
  assert.deepEqual(site("site-1.example"), { d: "site-1.example", m: 0, pk: 1 });
  assert.deepEqual(
    data.sites.map((entry) => entry.d),
    [...data.sites.map((entry) => entry.d)].sort(),
  );
});

test("site security refuses sources that came back too small or in the wrong shape", () => {
  assert.throws(() => buildSiteSecurity({ "a.example": {} }, passkeys, changePassword, builtAt), /2FA Directory: expected at least/);
  assert.throws(() => buildSiteSecurity([], passkeys, changePassword, builtAt), /not an object/);
  assert.throws(() => buildSiteSecurity(twoFactor, passkeys, {}, builtAt), /Change password URLs/);
});

test("only plain https links without credentials are kept", () => {
  assert.equal(safeUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  for (const bad of ["http://example.com/", "javascript:alert(1)", "https://user@example.com/", "https://localhost/", `https://example.com/${"a".repeat(600)}`, 42]) {
    assert.equal(safeUrl(bad), undefined, String(bad));
  }
});

test("CSV fields with quotes, commas, and line breaks are read correctly", () => {
  assert.deepEqual(parseCsv('"a","b, c","d ""e"""\r\n"f\ng",h,\n\n'), [
    ["a", "b, c", 'd "e"'],
    ["f\ng", "h", ""],
  ]);
});

test("California and Washington notices are read into one list, newest first", () => {
  const header = '"Organization Name","Date(s) of Breach  (if known)","Reported Date"';
  const rows = Array.from({ length: minimums.california }, (_, index) => `"Company ${index}","n/a","01/02/2025"`);
  const csv = [header, '"Example Games, Inc.","06/03/2026, 06/08/2026","10/06/2026"', '"No Date LLC","","not a date"', ...rows].join("\n");
  const california = californiaNotices(csv);
  assert.deepEqual(california[0], { s: "ca", n: "Example Games, Inc.", r: "2026-10-06", b: ["2026-06-03", "2026-06-08"] });
  assert.equal(california.length, minimums.california + 1);
  assert.throws(() => californiaNotices('"Name","Date"\n"x","y"'), /unexpected columns/);

  const waRows = Array.from({ length: minimums.washington }, (_, index) => ({ name: `Firm ${index}`, datesubmitted: "2025-01-01T00:00:00.000" }));
  const washington = washingtonNotices([
    { name: "zHealth, Inc.", datesubmitted: "2026-09-11T00:00:00.000", datestart: "2026-01-20T00:00:00.000", washingtoniansaffected: "1332", databreachcause: "Unauthorized Access" },
    { name: "", datesubmitted: "2026-09-11T00:00:00.000" },
    ...waRows,
  ]);
  assert.deepEqual(washington[0], { s: "wa", n: "zHealth, Inc.", r: "2026-09-11", b: ["2026-01-20"], a: 1332, c: "Unauthorized Access" });
  assert.throws(() => washingtonNotices(waRows.slice(0, 5)), /Washington: expected at least/);

  const merged = buildNotices(washington, california, builtAt);
  assert.equal(merged.notices[0]!.n, "Example Games, Inc.");
  assert.equal(merged.notices[1]!.n, "zHealth, Inc.");
});

test("packed data splits into parts that join back into the same gzip file, and the SQL swaps versions safely", () => {
  const data = buildSiteSecurity(twoFactor, passkeys, changePassword, builtAt);
  const packed = pack("site-security", data);
  assert.match(packed.version, /^[0-9a-f]{16}$/);
  assert.ok(packed.parts.every((part) => part.length <= partLength));
  const joined = Buffer.from(packed.parts.join(""), "base64");
  assert.equal(joined.length, packed.bytes);
  assert.deepEqual(JSON.parse(gunzipSync(joined).toString("utf8")), data);
  const sql = sqlFor(packed, builtAt).split("\n");
  assert.match(sql[0]!, /^DELETE FROM site_data_parts WHERE dataset = 'site-security' AND version = '[0-9a-f]{16}';$/);
  assert.match(sql.at(-2)!, /ON CONFLICT \(dataset\) DO UPDATE/);
  assert.match(sql.at(-1)!, /version <> '[0-9a-f]{16}'/);
  assert.ok(sql.every((line) => line.length < 100_000));
  assert.throws(() => sqlFor({ ...packed, parts: ["abc'); DROP TABLE x; --"] }, builtAt), /unexpected characters/);
});
