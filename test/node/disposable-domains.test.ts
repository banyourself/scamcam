import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleFor, neverDisposable, parseList } from "../../scripts/disposable-domains.ts";

const filler = Array.from({ length: 3000 }, (_, index) => `temp-${index}.example`);

test("the list is cleaned, sorted, and refused when it looks wrong", () => {
  const domains = parseList(["# comment", "", "Zzz-Mail.example", "aaa-mail.example ", ...filler, "aaa-mail.example"].join("\n"));
  assert.equal(domains.length, 3002);
  assert.equal(domains[0], "aaa-mail.example");
  assert.ok(domains.includes("zzz-mail.example"));
  assert.throws(() => parseList(filler.slice(0, 10).join("\n")), /expected 3000/);
  assert.throws(() => parseList([...filler, "not a domain"].join("\n")), /not a domain/);
  for (const provider of neverDisposable.slice(0, 3)) {
    assert.throws(() => parseList([...filler, provider].join("\n")), /real email providers/);
  }
});

test("the generated module records the commit and date and keeps only domain characters", () => {
  const source = moduleFor(["a-mail.example", "b-mail.example"], "2a79805ed6caf893921e3d0f0f85ac18a6fea99c", "2026-10-08");
  assert.match(source, /disposableListCommit = "2a79805ed6caf893921e3d0f0f85ac18a6fea99c"/);
  assert.match(source, /disposableDomainList = "a-mail\.example b-mail\.example"/);
  assert.throws(() => moduleFor([], "main", "2026-10-08"));
});
