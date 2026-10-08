import { describe, expect, it } from "vitest";
import { pages, planFor, servePage, siteOrigin } from "../../src/worker/pages";

const shellHtml = `<!doctype html><html><head><title>ScamCam - Check the Scan</title>
<meta name="description" content="default" /><meta name="robots" content="index, follow" />
<link rel="canonical" href="${siteOrigin}/" /><meta property="og:title" content="x" /><meta property="og:description" content="x" />
<meta property="og:url" content="x" /><meta name="twitter:title" content="x" /><meta name="twitter:description" content="x" />
</head><body><div id="root"></div></body></html>`;

function fakeAssets(seen: string[] = []): Fetcher {
  return {
    async fetch(input: RequestInfo | URL) {
      const url = new URL(input instanceof Request ? input.url : String(input));
      seen.push(url.pathname);
      if (url.pathname === "/") {
        return new Response(shellHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'self'", ETag: '"abc"' },
        });
      }
      return new Response("file", { headers: { "Content-Type": "text/plain" } });
    },
    connect() {
      throw new Error("not used");
    },
  } as unknown as Fetcher;
}

async function page(path: string, seen?: string[]) {
  const response = await servePage(new Request(siteOrigin + path), fakeAssets(seen));
  return { response, html: await response.text() };
}

describe("page tags for search engines and link previews", () => {
  it("gives every public page its own title, description, and canonical link", async () => {
    for (const [path, meta] of Object.entries(pages)) {
      const { response, html } = await page(path);
      expect(response.status).toBe(200);
      expect(html).toContain(`<link rel="canonical" href="${siteOrigin}${path}" />`);
      expect(html).toContain(`<meta name="description" content="${meta.description}" />`);
      expect(html).toContain(`<meta property="og:url" content="${siteOrigin}${path}" />`);
      expect(meta.description.length).toBeLessThanOrEqual(160);
      expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
      expect(response.headers.get("ETag")).toBeNull();
    }
    const { html } = await page("/how-it-works/");
    expect(html).toContain("<title>How it works | ScamCam</title>");
  });

  it("answers unknown pages with a real 404 that search engines skip", async () => {
    const { response, html } = await page("/no-such-page");
    expect(response.status).toBe(404);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).not.toContain('rel="canonical"');
    expect((await page("/design")).response.status).toBe(404);
  });

  it("keeps shared reports out of search results", async () => {
    const { response, html } = await page("/r/abc123");
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(html).toContain('<div id="root"></div>');
  });

  it("passes files straight through", async () => {
    const seen: string[] = [];
    const { html } = await page("/og-image.png", seen);
    expect(html).toBe("file");
    expect(seen).toEqual(["/og-image.png"]);
    expect(planFor("/.well-known/security.txt").kind).toBe("asset");
  });

  it("never lets a page title or description carry markup", () => {
    for (const meta of Object.values(pages)) {
      expect(meta.title).not.toMatch(/[<>"]/);
      expect(meta.description).not.toMatch(/[<>"]/);
    }
  });
});
