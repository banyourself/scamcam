import { describe, expect, it } from "vitest";
import {
  canonicalizeBytes,
  canonicalizeUrl,
  normalizeIpv4,
  safeBrowsingEndpoint,
  searchSafeBrowsing,
  urlExpressions,
} from "../../src/engine/safe-browsing";

const googleVectors: [string, string][] = [
  ["http://host/%25%32%35", "http://host/%25"],
  ["http://host/%25%32%35%25%32%35", "http://host/%25%25"],
  ["http://host/%2525252525252525", "http://host/%25"],
  ["http://host/asdf%25%32%35asd", "http://host/asdf%25asd"],
  ["http://host/%%%25%32%35asd%%", "http://host/%25%25%25asd%25%25"],
  ["http://www.google.com/", "http://www.google.com/"],
  [
    "http://%31%36%38%2e%31%38%38%2e%39%39%2e%32%36/%2E%73%65%63%75%72%65/%77%77%77%2E%65%62%61%79%2E%63%6F%6D/",
    "http://168.188.99.26/.secure/www.ebay.com/",
  ],
  [
    "http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/",
    "http://195.127.0.11/uploads/%20%20%20%20/.verify/.eBaysecure=updateuserdataxplimnbqmn-xplmvalidateinfoswqpcmlx=hgplmcx/",
  ],
  [
    "http://host%23.com/%257Ea%2521b%2540c%2523d%2524e%25f%255E00%252611%252A22%252833%252944_55%252B",
    "http://host%23.com/~a!b@c%23d$e%25f^00&11*22(33)44_55+",
  ],
  ["http://3279880203/blah", "http://195.127.0.11/blah"],
  ["http://www.google.com/blah/..", "http://www.google.com/"],
  ["www.google.com/", "http://www.google.com/"],
  ["www.google.com", "http://www.google.com/"],
  ["http://www.evil.com/blah#frag", "http://www.evil.com/blah"],
  ["http://www.GOOgle.com/", "http://www.google.com/"],
  ["http://www.google.com.../", "http://www.google.com/"],
  ["http://www.google.com/foo\tbar\rbaz\n2", "http://www.google.com/foobarbaz2"],
  ["http://www.google.com/q?", "http://www.google.com/q?"],
  ["http://www.google.com/q?r?", "http://www.google.com/q?r?"],
  ["http://www.google.com/q?r?s", "http://www.google.com/q?r?s"],
  ["http://evil.com/foo#bar#baz", "http://evil.com/foo"],
  ["http://evil.com/foo;", "http://evil.com/foo;"],
  ["http://evil.com/foo?bar;", "http://evil.com/foo?bar;"],
  ["http://\x01\x80.com/", "http://%01%80.com/"],
  ["http://notrailingslash.com", "http://notrailingslash.com/"],
  ["http://www.gotaport.com:1234/", "http://www.gotaport.com/"],
  ["  http://www.google.com/  ", "http://www.google.com/"],
  ["http:// leadingspace.com/", "http://%20leadingspace.com/"],
  ["http://%20leadingspace.com/", "http://%20leadingspace.com/"],
  ["%20leadingspace.com/", "http://%20leadingspace.com/"],
  ["https://www.securesite.com/", "https://www.securesite.com/"],
  ["http://host.com/ab%23cd", "http://host.com/ab%23cd"],
  ["http://host.com//twoslashes?more//slashes", "http://host.com/twoslashes?more//slashes"],
];

describe("Safe Browsing canonicalization", () => {
  it.each(googleVectors)("canonicalizes %j as Google documents", (input, expected) => {
    expect(canonicalizeBytes(input)).toBe(expected);
  });

  it("converts international domains to punycode and encodes UTF-8 paths", () => {
    expect(canonicalizeUrl("http://stеamcommunity.com/ü")).toBe("http://xn--stamcommunity-x3k.com/%C3%BC");
  });

  it("drops credentials before the host", () => {
    expect(canonicalizeUrl("https://steamcommunity.com@evil.example/login")).toBe("https://evil.example/login");
  });

  it("normalizes every IPv4 notation", () => {
    expect(normalizeIpv4("0xc3.0x7f.0.0xb")).toBe("195.127.0.11");
    expect(normalizeIpv4("0303.0177.0.013")).toBe("195.127.0.11");
    expect(normalizeIpv4("195.127.11")).toBe("195.127.0.11");
    expect(normalizeIpv4("example.com")).toBeNull();
    expect(normalizeIpv4("256.1.1.1")).toBeNull();
  });
});

describe("Safe Browsing expressions", () => {
  it("matches Google's example for a path with a query", () => {
    expect(urlExpressions("http://a.b.com/1/2.html?param=1")).toEqual([
      "a.b.com/1/2.html?param=1",
      "a.b.com/1/2.html",
      "a.b.com/",
      "a.b.com/1/",
      "b.com/1/2.html?param=1",
      "b.com/1/2.html",
      "b.com/",
      "b.com/1/",
    ]);
  });

  it("limits long hostnames to the registrable domain plus three more levels", () => {
    expect(urlExpressions("http://a.b.c.d.e.f.com/1.html")).toEqual([
      "a.b.c.d.e.f.com/1.html",
      "a.b.c.d.e.f.com/",
      "f.com/1.html",
      "f.com/",
      "e.f.com/1.html",
      "e.f.com/",
      "d.e.f.com/1.html",
      "d.e.f.com/",
      "c.d.e.f.com/1.html",
      "c.d.e.f.com/",
    ]);
  });

  it("uses only the address for IP hosts and respects multi-part suffixes", () => {
    expect(urlExpressions("http://1.2.3.4/1/")).toEqual(["1.2.3.4/1/", "1.2.3.4/"]);
    expect(urlExpressions("http://example.co.uk/1")).toEqual(["example.co.uk/1", "example.co.uk/"]);
  });

  it("caps paths at six and directories at four", () => {
    const expressions = urlExpressions("http://x.com/a/b/c/d/e/f.html?q=1");
    expect(expressions).toEqual([
      "x.com/a/b/c/d/e/f.html?q=1",
      "x.com/a/b/c/d/e/f.html",
      "x.com/",
      "x.com/a/",
      "x.com/a/b/",
      "x.com/a/b/c/",
    ]);
  });
});

async function fullHashBase64(expression: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(expression)));
  return btoa(String.fromCharCode(...digest));
}

describe("Safe Browsing lookup", () => {
  it("sends only 4-byte hash prefixes and matches full hashes locally", async () => {
    const requested: string[] = [];
    const matched = await fullHashBase64("phish.example/");
    const fetcher: typeof fetch = async (input) => {
      requested.push(String(input));
      return Response.json({
        fullHashes: [{ fullHash: matched, fullHashDetails: [{ threatType: "SOCIAL_ENGINEERING" }] }],
        cacheDuration: "300s",
      });
    };
    const result = await searchSafeBrowsing(["https://phish.example/login?u=1", "https://fine.example/"], "test-key", fetcher);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect([...result.threats.entries()]).toEqual([["https://phish.example/login?u=1", ["SOCIAL_ENGINEERING"]]]);
      expect(result.cacheSeconds).toBe(300);
    }
    expect(requested).toHaveLength(1);
    const url = new URL(requested[0]!);
    expect(`${url.origin}${url.pathname}`).toBe(safeBrowsingEndpoint);
    expect(url.searchParams.get("key")).toBe("test-key");
    const prefixes = url.searchParams.getAll("hashPrefixes");
    expect(prefixes.length).toBeGreaterThan(0);
    expect(prefixes.every((prefix) => atob(prefix).length === 4)).toBe(true);
    expect(requested[0]).not.toContain("phish.example");
    expect(requested[0]).not.toContain("login");
  });

  it("ignores canary and frame-only matches", async () => {
    const matched = await fullHashBase64("phish.example/");
    const fetcher: typeof fetch = async () =>
      Response.json({
        fullHashes: [
          { fullHash: matched, fullHashDetails: [{ threatType: "SOCIAL_ENGINEERING", attributes: ["CANARY"] }, { threatType: "MALWARE", attributes: ["FRAME_ONLY"] }] },
        ],
      });
    const result = await searchSafeBrowsing(["https://phish.example/"], "key", fetcher);
    expect(result.status === "ok" && result.threats.size).toBe(0);
  });

  it("reports errors and bad responses as unavailable", async () => {
    expect((await searchSafeBrowsing(["https://a.example/"], "key", async () => new Response("no", { status: 429 }))).status).toBe("unavailable");
    expect((await searchSafeBrowsing(["https://a.example/"], "key", async () => Response.json({ fullHashes: "nope" }))).status).toBe("unavailable");
    expect(
      (
        await searchSafeBrowsing(["https://a.example/"], "key", async () => {
          throw new TypeError("offline");
        })
      ).status,
    ).toBe("unavailable");
  });
});
