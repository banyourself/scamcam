import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryLookups } from "../../src/engine/cache";
import { buildShards, domainListKeepSeconds, domainListStaleAfterSeconds } from "../../src/engine/domain-list";
import { runDailyMaintenance, runWeeklyMaintenance } from "../../src/worker/maintenance/tasks";
import { domainListStatements } from "../../src/worker/repositories/domain-list-sql";
import { d1DomainList } from "../../src/worker/repositories/domain-lists";
import { nowInSeconds } from "../../src/worker/retention";

const listed = ["cheap-skins.example", "steam-gift.example", "login.free-nitro.example"];

async function loadList(version: string, syncedAt: number, names = listed) {
  const statements = domainListStatements({
    list: "phishing_database",
    version,
    syncedAt,
    expiresAt: syncedAt + domainListKeepSeconds,
    shards: await buildShards(names),
  });
  await env.DB.batch(statements.map((statement) => env.DB.prepare(statement)));
}

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM domain_list_shards"), env.DB.prepare("DELETE FROM domain_lists")]);
});

describe("Phishing.Database in D1", () => {
  it("finds listed names from the stored shards", async () => {
    await loadList("v1", nowInSeconds());
    const list = d1DomainList(env.DB, "phishing_database", memoryLookups());
    const result = await list.lookup(["steam-gift.example", "fine.example", "login.free-nitro.example"]);
    expect(result.status).toBe("ok");
    expect(result.status === "ok" && [...result.listed].sort()).toEqual(["login.free-nitro.example", "steam-gift.example"]);
  });

  it("is not configured before the first sync", async () => {
    const list = d1DomainList(env.DB, "phishing_database", memoryLookups());
    expect(await list.lookup(["steam-gift.example"])).toEqual({ status: "not_configured" });
  });

  it("stops using a copy that is more than three days old", async () => {
    const syncedAt = nowInSeconds() - domainListStaleAfterSeconds - 60;
    await loadList("v1", syncedAt);
    const list = d1DomainList(env.DB, "phishing_database", memoryLookups());
    expect(await list.lookup(["steam-gift.example"])).toEqual({ status: "stale" });
  });

  it("keeps recently read shards in memory until the list version changes", async () => {
    await loadList("v1", nowInSeconds());
    const lookups = memoryLookups();
    const list = d1DomainList(env.DB, "phishing_database", lookups);
    expect((await list.lookup(["cheap-skins.example"])).status).toBe("ok");
    await env.DB.prepare("UPDATE domain_list_shards SET hashes = X''").run();
    const remembered = await list.lookup(["cheap-skins.example"]);
    expect(remembered.status === "ok" && remembered.listed.has("cheap-skins.example")).toBe(true);
    await env.DB.prepare("UPDATE domain_lists SET version = 'v2'").run();
    const refreshed = await list.lookup(["cheap-skins.example"]);
    expect(refreshed.status === "ok" && refreshed.listed.size).toBe(0);
  });

  it("replaces the old copy in place on the next sync", async () => {
    await loadList("v1", nowInSeconds());
    await loadList("v2", nowInSeconds(), ["new-scam.example"]);
    const counts = await env.DB.prepare("SELECT COUNT(*) AS shards, SUM(entries) AS keys FROM domain_list_shards").first<{ shards: number; keys: number }>();
    expect(counts).toEqual({ shards: 1024, keys: 1 });
    const list = d1DomainList(env.DB, "phishing_database", memoryLookups());
    const result = await list.lookup(["steam-gift.example", "new-scam.example"]);
    expect(result.status === "ok" && [...result.listed]).toEqual(["new-scam.example"]);
  });

  it("is deleted by the daily cleanup a week after the last sync and reported weekly", async () => {
    await loadList("v1", nowInSeconds());
    const weekly = await runWeeklyMaintenance(env);
    expect(weekly.lists).toEqual({ phishing_database: { version: "v1", entries: 3, ageHours: 0 } });
    await env.DB.batch([
      env.DB.prepare("UPDATE domain_list_shards SET expires_at = 1"),
      env.DB.prepare("UPDATE domain_lists SET expires_at = 1"),
    ]);
    const daily = await runDailyMaintenance(env);
    expect(daily.deleted).toMatchObject({ domain_lists: 1, domain_list_shards: 1024 });
    const left = await env.DB.prepare("SELECT COUNT(*) AS total FROM domain_list_shards").first<{ total: number }>();
    expect(left?.total).toBe(0);
  });
});
