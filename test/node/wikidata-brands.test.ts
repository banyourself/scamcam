import assert from "node:assert/strict";
import { test } from "node:test";
import { brands } from "../../src/engine/brands.ts";
import { askWikidata, compareBrand, formatReport, registrableDomain, rowsFrom, sparqlFor, wikidataItems } from "../../scripts/wikidata-brands.ts";

const binding = (item: string, label: string | null, website: string | null) => ({
  item: { type: "uri", value: `http://www.wikidata.org/entity/${item}` },
  ...(label ? { label: { type: "literal", value: label } } : {}),
  ...(website ? { website: { type: "uri", value: website } } : {}),
});

test("every brand has Wikidata items and every item ID is well formed", () => {
  for (const brand of brands) {
    const items = wikidataItems[brand.id];
    assert.ok(items && items.length > 0, `${brand.id} has no Wikidata items`);
    assert.doesNotThrow(() => sparqlFor(items));
  }
  assert.deepEqual(Object.keys(wikidataItems).sort(), brands.map((brand) => brand.id).sort());
});

test("the query only accepts item IDs, so nothing else reaches SPARQL", () => {
  assert.match(sparqlFor(["Q1", "Q42"]), /VALUES \?item \{ wd:Q1 wd:Q42 \}/);
  assert.throws(() => sparqlFor([]));
  assert.throws(() => sparqlFor(["Q1 } DELETE {"]));
  assert.throws(() => sparqlFor(["P856"]));
  assert.throws(() => sparqlFor(["Q0"]));
});

test("rows keep only well formed items and read missing fields as null", () => {
  const rows = rowsFrom({ results: { bindings: [binding("Q1", "One", "https://one.example/"), binding("Q2", null, null), { item: { value: "not-an-item" } }] } });
  assert.deepEqual(rows, [
    { item: "Q1", label: "One", website: "https://one.example/" },
    { item: "Q2", label: null, website: null },
  ]);
  assert.throws(() => rowsFrom({ head: {} }));
  assert.throws(() => rowsFrom(null));
});

test("websites reduce to their registrable domain and other schemes are ignored", () => {
  assert.equal(registrableDomain("https://store.steampowered.com/app/1"), "steampowered.com");
  assert.equal(registrableDomain("http://www.dota2.com/"), "dota2.com");
  assert.equal(registrableDomain("https://www.nintendo.co.jp/"), "nintendo.co.jp");
  assert.equal(registrableDomain("ftp://files.example.com/"), null);
  assert.equal(registrableDomain("not a url"), null);
});

test("a brand report separates shared, Wikidata only, and list only domains", () => {
  const brand = { id: "demo", name: "Demo", officialDomains: ["demo.example", "demo-cdn.example"], lookalikeLabels: ["demo"], tokens: ["demo"] };
  const report = compareBrand(brand, [
    { item: "Q1", label: "Demo", website: "https://www.demo.example/" },
    { item: "Q1", label: "Demo", website: "https://shop.demo.example/" },
    { item: "Q2", label: null, website: "https://demo-corp.example/" },
  ]);
  assert.deepEqual(report.confirmed, ["demo.example"]);
  assert.deepEqual(report.onlyOnWikidata, [{ domain: "demo-corp.example", website: "https://demo-corp.example/", item: "Q2" }]);
  assert.deepEqual(report.onlyInList, ["demo-cdn.example"]);
  assert.deepEqual(report.items[0]!.websites, ["https://www.demo.example/", "https://shop.demo.example/"]);
  const text = formatReport([report], [{ id: "other", reason: "Wikidata answered 500" }]);
  assert.match(text, /Only on Wikidata, review before adding: demo-corp\.example/);
  assert.match(text, /Not checked: other \(Wikidata answered 500\)/);
  assert.match(text, /1 brand checked, 1 Wikidata domain not in the brand list/);
});

test("Wikidata is asked with a contact User-Agent and retried when busy", async () => {
  const calls: { url: string; agent: string | null }[] = [];
  const waits: number[] = [];
  const answers = [new Response("busy", { status: 429, headers: { "retry-after": "2" } }), Response.json({ results: { bindings: [binding("Q8093", "Nintendo", "https://www.nintendo.com/")] } })];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), agent: new Headers(init?.headers).get("User-Agent") });
    return answers.shift()!;
  }) as typeof fetch;
  const rows = await askWikidata(["Q8093"], fetcher, async (ms) => waits.push(ms));
  assert.deepEqual(rows, [{ item: "Q8093", label: "Nintendo", website: "https://www.nintendo.com/" }]);
  assert.equal(calls.length, 2);
  assert.ok(calls[0]!.url.startsWith("https://query.wikidata.org/sparql?"));
  assert.match(calls[0]!.agent ?? "", /kevin@kevinle\.tech/);
  assert.deepEqual(waits, [2000]);
  await assert.rejects(askWikidata(["Q8093"], (async () => new Response("no", { status: 403 })) as typeof fetch, async () => undefined), /Wikidata answered 403/);
});
