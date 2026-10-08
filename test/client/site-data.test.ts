import { describe, expect, it } from "vitest";
import { loadBreachNotices, loadGzipJson, loadSiteSecurity } from "../../src/client/lib/site-data";
import {
  companyKey,
  isBreachNotices,
  isSiteSecurity,
  maskOf,
  methodsOf,
  searchNotices,
  searchSites,
  type BreachNotices,
  type SiteSecurity,
} from "../../src/shared/site-data";

async function gzipResponse(value: unknown, type = "application/gzip", status = 200): Promise<Response> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(await new Response(stream).arrayBuffer(), { status, headers: { "Content-Type": type } });
}

const security: SiteSecurity = {
  v: 1,
  builtAt: "2026-10-08T23:00:00.000Z",
  sites: [
    { d: "discord.com", m: maskOf(["sms", "totp", "u2f"]), doc: "https://support.discord.com/hc/en-us/articles/219576828", pk: 1 },
    { d: "discordapp.com", m: maskOf(["sms", "totp", "u2f"]) },
    { d: "store.steampowered.com", m: maskOf(["email", "custom-software"]), sw: ["Steam Mobile"] },
    { d: "mail.google.com", m: maskOf(["totp", "u2f"]) },
    { d: "google.com", cp: "https://myaccount.google.com/signinoptions/password" },
    { d: "nosecurity.example", m: 0 },
  ],
};

const notices: BreachNotices = {
  v: 1,
  builtAt: "2026-10-08T23:00:00.000Z",
  notices: [
    { s: "ca", n: "Example Games, Inc.", r: "2026-10-01", b: ["2026-09-01"] },
    { s: "wa", n: "Example Games Inc", r: "2026-09-20", a: 1332, c: "Unauthorized Access" },
    { s: "ca", n: "Examples Unlimited LLC", r: "2026-08-01" },
    { s: "ca", n: "T-Mobile USA, Inc.", r: "2026-05-01" },
    { s: "wa", n: "Bank of America, N.A.", r: "2026-04-01", a: 20 },
  ],
};

describe("site data loading", () => {
  it("unpacks the gzip file the server sends and checks its shape", async () => {
    let asked = "";
    const fetcher = (async (input: string | URL | Request) => {
      asked = String(input);
      return gzipResponse(security);
    }) as typeof fetch;
    expect(await loadSiteSecurity(fetcher)).toEqual(security);
    expect(asked).toBe("/api/v1/site-security");
    expect(await loadBreachNotices((async () => gzipResponse(notices)) as typeof fetch)).toEqual(notices);
  });

  it("returns nothing for errors, other content types, broken files, and the wrong shape", async () => {
    expect(await loadSiteSecurity((async () => gzipResponse(security, "application/gzip", 503)) as typeof fetch)).toBeNull();
    expect(await loadSiteSecurity((async () => gzipResponse(security, "text/html")) as typeof fetch)).toBeNull();
    expect(await loadGzipJson("/x", (async () => new Response("not gzip", { headers: { "Content-Type": "application/gzip" } })) as typeof fetch)).toBeNull();
    expect(await loadSiteSecurity((async () => gzipResponse(notices)) as typeof fetch)).toBeNull();
    expect(await loadBreachNotices((async () => gzipResponse({ ...notices, notices: [{ s: "tx", n: "x", r: "2026-01-01" }] })) as typeof fetch)).toBeNull();
    expect(await loadSiteSecurity((async () => Promise.reject(new Error("offline"))) as typeof fetch)).toBeNull();
  });

  it("accepts only well formed entries", () => {
    expect(isSiteSecurity(security)).toBe(true);
    expect(isSiteSecurity({ ...security, sites: [{ d: "a.example", m: "1" }] })).toBe(false);
    expect(isBreachNotices(notices)).toBe(true);
    expect(isBreachNotices({ ...notices, notices: [{ s: "ca", n: "x", r: "10/01/2026" }] })).toBe(false);
    expect(isBreachNotices({ ...notices, notices: [{ s: "ca", n: "x", r: "2026-10-01", a: -1 }] })).toBe(false);
  });
});

describe("site search", () => {
  it("ranks the exact site and its name first", () => {
    expect(searchSites(security, "discord").map((site) => site.d)).toEqual(["discord.com", "discordapp.com"]);
    expect(searchSites(security, "discord.com")[0]!.d).toBe("discord.com");
    expect(searchSites(security, "steam").map((site) => site.d)).toEqual(["store.steampowered.com"]);
    expect(searchSites(security, "google").map((site) => site.d)).toEqual(["google.com", "mail.google.com"]);
    expect(searchSites(security, "x")).toEqual([]);
  });

  it("turns method lists into bits and back in a fixed order, strongest first", () => {
    expect(methodsOf(maskOf(["sms", "u2f", "totp", "unknown"]))).toEqual(["totp", "u2f", "sms"]);
    expect(methodsOf(0)).toEqual([]);
  });

  it("matches breach notices by company name, ignoring legal endings and punctuation", () => {
    expect(companyKey("Example Games, Inc.")).toBe("example games");
    expect(companyKey("T-Mobile USA, Inc.")).toBe("t mobile usa");
    expect(searchNotices(notices, "example games").map((notice) => notice.s)).toEqual(["ca", "wa"]);
    expect(searchNotices(notices, "t-mobile").map((notice) => notice.n)).toEqual(["T-Mobile USA, Inc."]);
    expect(searchNotices(notices, "bank of america")[0]!.a).toBe(20);
    expect(searchNotices(notices, "example").map((notice) => notice.n)).toEqual(["Example Games, Inc.", "Example Games Inc"]);
    expect(searchNotices(notices, "examplegames.com").map((notice) => notice.n)).toEqual([]);
    expect(searchNotices(notices, "ex")).toEqual([]);
  });
});
