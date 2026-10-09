import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { buildShards, domainListDetails, domainListKeepSeconds, domainListKey, shardOf, type DomainListName, type ListName } from "../../src/engine/domain-list";
import { runDailyMaintenance, runWeeklyMaintenance } from "../../src/worker/maintenance/tasks";
import { domainListStatements } from "../../src/worker/repositories/domain-list-sql";
import { d1DomainLists } from "../../src/worker/repositories/domain-lists";
import { nowInSeconds } from "../../src/worker/retention";
import { countingDatabase } from "./counting";

const listed = ["cheap-skins.example", "steam-gift.example", "login.free-nitro.example"];

async function loadList(version: string, syncedAt: number, names = listed, list: ListName = "phishing_database") {
  const statements = domainListStatements({
    list,
    version,
    syncedAt,
    expiresAt: syncedAt + domainListKeepSeconds,
    shards: await buildShards(names),
  });
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

async function phishing(names: string[], lookups = memoryLookups()) {
  return (await d1DomainLists(env.DB, lookups).lookup(names)).get("phishing_database");
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM domain_list_shards"), env.DB.prepare("DELETE FROM domain_lists")]);
});

describe("scam lists in D1", () => {
  it("finds listed names from the stored shards", async () => {
    await loadList("v1", nowInSeconds());
    const result = await phishing(["steam-gift.example", "fine.example", "login.free-nitro.example"]);
    expect(result?.status).toBe("ok");
    expect(result?.status === "ok" && [...result.listed].sort()).toEqual(["login.free-nitro.example", "steam-gift.example"]);
  });

  it("is not configured before the first sync", async () => {
    expect(await phishing(["steam-gift.example"])).toEqual({ status: "not_configured" });
  });

  it("stops using a copy whose source data is more than a week old", async () => {
    await loadList("v1", nowInSeconds() - domainListDetails.phishing_database.staleAfterDays * 86_400 - 60);
    expect(await phishing(["steam-gift.example"])).toEqual({ status: "stale" });
  });

  it("checks every configured list in two queries", async () => {
    await loadList("v1", nowInSeconds());
    await loadList("m1", nowInSeconds(), ["wallet-claim.example", "steam-gift.example"], "metamask");
    await loadList("s1", nowInSeconds(), ["free-nitro-drop.example"], "scam_links");
    const counter = { queries: 0 };
    const results = await d1DomainLists(countingDatabase(env.DB, counter), memoryLookups()).lookup(["steam-gift.example", "wallet-claim.example", "free-nitro-drop.example", "fine.example"]);
    expect(counter.queries).toBe(2);
    const listedBy = (name: DomainListName) => {
      const result = results.get(name);
      return result?.status === "ok" ? [...result.listed].sort() : result?.status;
    };
    expect(listedBy("phishing_database")).toEqual(["steam-gift.example"]);
    expect(listedBy("metamask")).toEqual(["steam-gift.example", "wallet-claim.example"]);
    expect(listedBy("scam_links")).toEqual(["free-nitro-drop.example"]);
    expect(listedBy("scamsniffer")).toBe("not_configured");
  });

  it("keeps recently read shards in memory until the list version changes", async () => {
    await loadList("v1", nowInSeconds());
    const lookups = memoryLookups();
    expect((await phishing(["cheap-skins.example"], lookups))?.status).toBe("ok");
    await env.DB.prepare("UPDATE domain_list_shards SET hashes = X''").run();
    const remembered = await phishing(["cheap-skins.example"], lookups);
    expect(remembered?.status === "ok" && remembered.listed.has("cheap-skins.example")).toBe(true);
    await env.DB.prepare("UPDATE domain_lists SET version = 'v2'").run();
    const refreshed = await phishing(["cheap-skins.example"], lookups);
    expect(refreshed?.status === "ok" && refreshed.listed.size).toBe(0);
  });

  it("keeps answering from a valid mix of old and new shards when a sync stops partway", async () => {
    const before = nowInSeconds() - 3600;
    await loadList("v1", before, ["cheap-skins.example", "steam-gift.example"]);
    const next = await buildShards(["steam-gift.example", "new-scam.example"]);
    const statements = domainListStatements({ list: "phishing_database", version: "v2", syncedAt: nowInSeconds(), expiresAt: nowInSeconds() + domainListKeepSeconds, shards: next });
    const newShard = shardOf(await domainListKey("new-scam.example"));
    expect(shardOf(await domainListKey("cheap-skins.example"))).not.toBe(newShard);
    await env.DB.prepare(statements[newShard]!).run();
    const lookups = memoryLookups();
    const partial = await phishing(["cheap-skins.example", "steam-gift.example", "new-scam.example"], lookups);
    expect(partial?.status === "ok" && [...partial.listed].sort()).toEqual(["cheap-skins.example", "new-scam.example", "steam-gift.example"]);
    expect(partial?.status === "ok" && partial.syncedAt).toBe(before);
    await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
    const finished = await phishing(["cheap-skins.example", "steam-gift.example", "new-scam.example"], lookups);
    expect(finished?.status === "ok" && [...finished.listed].sort()).toEqual(["new-scam.example", "steam-gift.example"]);
  });

  it("replaces the old copy in place on the next sync", async () => {
    await loadList("v1", nowInSeconds());
    await loadList("v2", nowInSeconds(), ["new-scam.example"]);
    const counts = await env.DB.prepare("SELECT COUNT(*) AS shards, SUM(entries) AS keys FROM domain_list_shards").first<{ shards: number; keys: number }>();
    expect(counts).toEqual({ shards: 1024, keys: 1 });
    const result = await phishing(["steam-gift.example", "new-scam.example"]);
    expect(result?.status === "ok" && [...result.listed]).toEqual(["new-scam.example"]);
  });

  it("refuses list names that could break the SQL, and the database refuses names it does not know", async () => {
    expect(() => domainListStatements({ list: "x'); DROP TABLE domain_lists; --" as DomainListName, version: "v1", syncedAt: 1, expiresAt: 2, shards: [] })).toThrow(RangeError);
    const [statement] = domainListStatements({ list: "openphish" as DomainListName, version: "v1", syncedAt: 1, expiresAt: 2, shards: [] });
    await expect(env.DB.prepare(statement!).run()).rejects.toThrow();
  });

  it("is deleted by the daily cleanup after it expires and reported weekly", async () => {
    await loadList("v1", nowInSeconds());
    const weekly = await runWeeklyMaintenance(env);
    const lists = weekly.lists as Record<string, unknown>;
    expect(lists.phishing_database).toEqual({ version: "v1", entries: 3, ageHours: 0, refreshedHoursAgo: 0 });
    expect(lists.metamask).toBeNull();
    await env.DB.batch([
      env.DB.prepare("UPDATE domain_list_shards SET expires_at = 1"),
      env.DB.prepare("UPDATE domain_lists SET expires_at = 1"),
    ]);
    const daily = await runDailyMaintenance(env);
    expect(daily.deleted).toMatchObject({ domain_lists: 1, domain_list_shards: 1024 });
    const left = await env.DB.prepare("SELECT COUNT(*) AS total FROM domain_list_shards").first<{ total: number }>();
    expect(left?.total).toBe(0);
  });

  it("checks phone numbers against the FTC list in the same two queries, never against site lists", async () => {
    const now = nowInSeconds();
    await loadList("v1", now, [...listed, "+14695550147"]);
    await loadList("ftc-1", now, ["+14695550147", "+12025550123"], "ftc_dnc");
    const counter = { queries: 0 };
    const results = await d1DomainLists(countingDatabase(env.DB, counter), memoryLookups()).lookup(["steam-gift.example", "+14695550147", "+17145550199"]);
    expect(counter.queries).toBe(2);
    const reports = results.get("ftc_dnc");
    expect(reports?.status === "ok" && [...reports.listed]).toEqual(["+14695550147"]);
    const sites = results.get("phishing_database");
    expect(sites?.status === "ok" && [...sites.listed]).toEqual(["steam-gift.example"]);
  });

  it("checks wallets and FCC numbers in the same two queries, each only against its own kind of list", async () => {
    const now = nowInSeconds();
    const wallet = `0x${"ab".repeat(20)}`;
    await loadList("v1", now, [...listed, wallet]);
    await loadList("fcc-1", now, ["+14695550147"], "fcc_complaints");
    await loadList("wallets-1", now, [wallet, "steam-gift.example"], "scamsniffer_wallets");
    const counter = { queries: 0 };
    const results = await d1DomainLists(countingDatabase(env.DB, counter), memoryLookups()).lookup(["steam-gift.example", "+14695550147", wallet]);
    expect(counter.queries).toBe(2);
    const listedIn = (list: ListName) => {
      const result = results.get(list);
      return result?.status === "ok" ? [...result.listed] : null;
    };
    expect(listedIn("scamsniffer_wallets")).toEqual([wallet]);
    expect(listedIn("fcc_complaints")).toEqual(["+14695550147"]);
    expect(listedIn("phishing_database")).toEqual(["steam-gift.example"]);
    expect(listedIn("ftc_dnc")).toBeNull();
  });
});
