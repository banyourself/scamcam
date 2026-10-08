export const siteOrigin = "https://scamcam.kevinle.tech";
const siteTitle = "ScamCam - Check the Scan";

interface PageMeta {
  title: string;
  description: string;
}

export const pages: Record<string, PageMeta> = {
  "/": {
    title: siteTitle,
    description:
      "Free scam checker. Paste a suspicious link, text, or email, or drop a screenshot or Minecraft mod, and see the evidence. No account needed.",
  },
  "/how-it-works": {
    title: "How it works",
    description:
      "How ScamCam checks a link, message, screenshot, or file: evidence from independent sources, compared before it reaches a verdict you can inspect.",
  },
  "/extension": {
    title: "Browser extension",
    description: "Check a link, a message, or a whole page without copying and pasting. Right-click it and choose Check with ScamCam.",
  },
  "/stats": {
    title: "Totals",
    description: "How many checks ScamCam ran in the last 7 and 30 days, and how many came back as scams. Counted anonymously.",
  },
  "/privacy": { title: "Privacy policy", description: "ScamCam is built to know as little about you as possible. Here is exactly what it handles and for how long." },
  "/terms": { title: "Terms of service", description: "The terms for using ScamCam, a free, noncommercial scam and phishing checker." },
  "/acceptable-use": { title: "Acceptable use", description: "What ScamCam may and may not be used for." },
  "/cookies": { title: "Cookies", description: "ScamCam does not use advertising, analytics, or tracking cookies, so there is no cookie banner." },
  "/accessibility": { title: "Accessibility", description: "How ScamCam supports keyboard, screen reader, and reduced motion users, and how to report a barrier." },
  "/security": { title: "Security", description: "ScamCam handles content that may be malicious, so it is built to never trust it." },
  "/disclosure": { title: "Vulnerability disclosure", description: "How to report a security issue in ScamCam and what to expect in return." },
  "/contact": { title: "Contact", description: "ScamCam is run by one person. Email is the fastest way to reach me." },
};

const robotsOff = "noindex, nofollow";

export function fullTitle(title: string): string {
  return title === siteTitle ? title : `${title} | ScamCam`;
}

type Plan = { kind: "page"; path: string; meta: PageMeta } | { kind: "private" } | { kind: "missing" } | { kind: "asset" };

export function planFor(pathname: string): Plan {
  if (pathname.startsWith("/r/")) {
    return { kind: "private" };
  }
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (last.includes(".") || pathname.startsWith("/.well-known/")) {
    return { kind: "asset" };
  }
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const meta = pages[path];
  return meta ? { kind: "page", path, meta } : { kind: "missing" };
}

function setContent(value: string) {
  return {
    element(element: Element) {
      element.setAttribute("content", value);
    },
  };
}

export function tagPage(shell: Response, path: string, meta: PageMeta): Response {
  const url = siteOrigin + path;
  const title = fullTitle(meta.title);
  return new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(title);
      },
    })
    .on('link[rel="canonical"]', {
      element(element) {
        element.setAttribute("href", url);
      },
    })
    .on('meta[name="description"]', setContent(meta.description))
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(meta.description))
    .on('meta[property="og:url"]', setContent(url))
    .on('meta[name="twitter:title"]', setContent(title))
    .on('meta[name="twitter:description"]', setContent(meta.description))
    .transform(shell);
}

export function hidePage(shell: Response): Response {
  return new HTMLRewriter()
    .on('meta[name="robots"]', setContent(robotsOff))
    .on('link[rel="canonical"]', {
      element(element) {
        element.remove();
      },
    })
    .transform(shell);
}

function finish(response: Response, status: number, hidden: boolean): Response {
  const headers = new Headers(response.headers);
  headers.delete("ETag");
  headers.delete("Last-Modified");
  if (hidden) {
    headers.set("X-Robots-Tag", robotsOff);
  }
  return new Response(response.body, { status, headers });
}

export async function servePage(request: Request, assets: Fetcher): Promise<Response> {
  const url = new URL(request.url);
  const plan = planFor(url.pathname);
  if (plan.kind === "asset") {
    return assets.fetch(request);
  }
  const shell = await assets.fetch(new Request(new URL("/", url), { method: request.method === "HEAD" ? "HEAD" : "GET" }));
  if (!shell.ok || !(shell.headers.get("Content-Type") ?? "").includes("text/html")) {
    return shell;
  }
  if (plan.kind === "page") {
    return finish(tagPage(shell, plan.path, plan.meta), 200, false);
  }
  return finish(hidePage(shell), plan.kind === "missing" ? 404 : 200, true);
}
