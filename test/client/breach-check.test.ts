import { describe, expect, it } from "vitest";
import { checkPassword, loadBreachCatalog, sha1Hex } from "../../src/client/lib/breach-check";
import type { BreachCatalog, BreachEntry } from "../../src/shared/api";
import { isBreachCatalog, searchBreaches, searchTerm } from "../../src/shared/breaches";

const password = "correct horse probe 7q4";

function recorder(answer: (url: string) => Response | Promise<Response>) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    seen.push({ url, init });
    return answer(url);
  };
  return { fetcher, seen };
}

function entry(overrides: Partial<BreachEntry> & { name: string }): BreachEntry {
  return { title: overrides.name, domain: "", breachDate: "2020-01-01", addedDate: "2020-02-01", accounts: 10, classes: [0], notes: [], ...overrides };
}

const catalog: BreachCatalog = {
  fetchedAt: "2026-10-08T12:00:00.000Z",
  dataClasses: ["Email addresses"],
  breaches: [
    entry({ name: "Adobe", domain: "adobe.com", breachDate: "2013-10-04" }),
    entry({ name: "AdobeForums", title: "Adobe Forums", domain: "forums.adobe.example", breachDate: "2015-01-01" }),
    entry({ name: "Readobe", title: "Readobe", domain: "readobe.example" }),
    entry({ name: "Canva", domain: "canva.com" }),
  ],
};

describe("checking a password in the browser", () => {
  it("sends only the first 5 characters of the SHA-1 fingerprint and finds the count itself", async () => {
    const hash = await sha1Hex(password);
    expect(hash).toMatch(/^[0-9A-F]{40}$/);
    const { fetcher, seen } = recorder(() => new Response(`${"A".repeat(35)}:2\r\n${hash.slice(5)}:1234\r\n${"B".repeat(35)}:0\r\n`));
    expect(await checkPassword(password, fetcher)).toEqual({ status: "found", count: 1234 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`/api/v1/passwords/range/${hash.slice(0, 5)}`);
    expect(seen[0]!.init?.body).toBeUndefined();
    const sent = JSON.stringify(seen);
    expect(sent).not.toContain(hash.slice(5));
    expect(sent).not.toContain("probe 7q4");
  });

  it("says when the password is not in the range, ignoring padding", async () => {
    const hash = await sha1Hex(password);
    const { fetcher } = recorder(() => new Response(`${hash.slice(5)}:0\r\n${"C".repeat(35)}:9\r\n`));
    expect(await checkPassword(password, fetcher)).toEqual({ status: "not_found" });
  });

  it("matches the known fingerprint of the word password", async () => {
    expect(await sha1Hex("password")).toBe("5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
  });

  it("reports limits and failures without guessing", async () => {
    expect(await checkPassword(password, recorder(() => new Response("{}", { status: 429 })).fetcher)).toEqual({ status: "rate_limited" });
    expect(await checkPassword(password, recorder(() => new Response("{}", { status: 503 })).fetcher)).toEqual({ status: "unavailable" });
    expect(await checkPassword(password, recorder(() => Promise.reject(new TypeError("offline"))).fetcher)).toEqual({ status: "unavailable" });
  });
});

describe("searching the breach list in the browser", () => {
  it("turns a pasted link into its site name", () => {
    expect(searchTerm("  https://www.Adobe.com/account/login?x=1 ")).toBe("adobe.com");
    expect(searchTerm("www.canva.com/design")).toBe("canva.com");
    expect(searchTerm("Adobe")).toBe("adobe");
  });

  it("puts the site itself first, then names that start with the words, then the rest", () => {
    expect(searchBreaches(catalog, "adobe.com").map((item) => item.name)).toEqual(["Adobe"]);
    expect(searchBreaches(catalog, "login.adobe.com").map((item) => item.name)).toEqual(["Adobe"]);
    expect(searchBreaches(catalog, "adobe").map((item) => item.name)).toEqual(["Adobe", "AdobeForums", "Readobe"]);
    expect(searchBreaches(catalog, "a")).toEqual([]);
    expect(searchBreaches(catalog, "nothing-like-it")).toEqual([]);
  });

  it("loads the list from ScamCam only and refuses anything that is not a breach list", async () => {
    const good = recorder(() => Response.json(catalog));
    expect(await loadBreachCatalog(good.fetcher)).toEqual(catalog);
    expect(good.seen.map((request) => request.url)).toEqual(["/api/v1/breaches"]);
    expect(await loadBreachCatalog(recorder(() => Response.json({ breaches: "nope" })).fetcher)).toBeNull();
    expect(await loadBreachCatalog(recorder(() => new Response("{}", { status: 503 })).fetcher)).toBeNull();
    expect(isBreachCatalog({ ...catalog, breaches: [{ name: 1 }] })).toBe(false);
  });
});
