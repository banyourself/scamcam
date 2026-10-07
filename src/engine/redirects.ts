import { getDomain } from "tldts";

export const maxUnwrapDepth = 3;

export interface Unwrapped {
  target: string;
  via: string;
}

type Reader = (url: URL) => string | null;

interface Redirector {
  name: string;
  domain: string | RegExp;
  host?: RegExp;
  path?: RegExp;
  read: Reader;
}

const absoluteUrl = /^https?:\/\/[^\s/?#]+/i;

const genericParameters = new Set([
  "url", "u", "redirect", "redirect_url", "redirect_uri", "redirecturl", "redir", "next", "target", "dest",
  "destination", "continue", "return", "returnto", "return_to", "returnurl", "goto", "link", "out", "to", "r",
]);

function parameter(...names: string[]): Reader {
  return (url) => {
    for (const name of names) {
      const value = url.searchParams.get(name);
      if (value) {
        return value;
      }
    }
    return null;
  };
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function proofpointV2(url: URL): string | null {
  const value = url.searchParams.get("u");
  return value ? safeDecode(value.replaceAll("-", "%").replaceAll("_", "/")) : null;
}

function proofpointV3(url: URL): string | null {
  return /^\/v3\/__(.+?)__;/.exec(url.pathname)?.[1] ?? null;
}

function bing(url: URL): string | null {
  const value = url.searchParams.get("u");
  if (!value?.startsWith("a1")) {
    return null;
  }
  try {
    const base64 = value.slice(2).replaceAll("-", "+").replaceAll("_", "/");
    return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  } catch {
    return null;
  }
}

const redirectors: Redirector[] = [
  { name: "Steam's link filter", domain: "steamcommunity.com", path: /^\/linkfilter\/?$/, read: parameter("u", "url") },
  { name: "A Google redirect", domain: /^google\.[a-z.]+$/, path: /^\/url$/, read: parameter("q", "url") },
  { name: "Google AMP", domain: /^google\.[a-z.]+$/, path: /^\/amp\/s\/./, read: (url) => `https://${url.pathname.slice("/amp/s/".length)}${url.search}` },
  { name: "Microsoft Safe Links", domain: "outlook.com", host: /\.safelinks\.protection\.outlook\.com$/, read: parameter("url") },
  { name: "Proofpoint", domain: "proofpoint.com", host: /^urldefense\.proofpoint\.com$/, path: /^\/v2\/url$/, read: proofpointV2 },
  { name: "Proofpoint", domain: "urldefense.com", path: /^\/v3\/__/, read: proofpointV3 },
  { name: "Facebook's link redirect", domain: "facebook.com", host: /^l[m]?\.facebook\.com$/, read: parameter("u") },
  { name: "Instagram's link redirect", domain: "instagram.com", host: /^l\.instagram\.com$/, read: parameter("u") },
  { name: "YouTube's link redirect", domain: "youtube.com", path: /^\/redirect$/, read: parameter("q") },
  { name: "Reddit's link redirect", domain: "reddit.com", host: /^out\.reddit\.com$/, read: parameter("url") },
  { name: "LinkedIn's link redirect", domain: "linkedin.com", path: /^\/redir\/redirect$/, read: parameter("url") },
  { name: "Slack's link redirect", domain: "slack-redir.net", read: parameter("url") },
  { name: "VK's link redirect", domain: "vk.com", path: /^\/away\.php$/, read: parameter("to") },
  { name: "A Bing redirect", domain: "bing.com", path: /^\/ck\/a$/, read: bing },
  { name: "Tumblr's link redirect", domain: "tumblr.com", host: /^t\.umblr\.com$/, read: parameter("z") },
  { name: "href.li", domain: "href.li", read: (url) => safeDecode(url.search.slice(1)) },
];

export function isRedirectorHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const domain = getDomain(host) ?? host;
  return redirectors.some((redirector) => matchesDomain(redirector.domain, domain) && (!redirector.host || redirector.host.test(host)) && !redirector.path);
}

function matchesDomain(rule: string | RegExp, domain: string): boolean {
  return typeof rule === "string" ? rule === domain : rule.test(domain);
}

function asTarget(value: string | null, wrapperDomain: string | null): string | null {
  const candidate = value?.trim();
  if (!candidate || !absoluteUrl.test(candidate)) {
    return null;
  }
  try {
    const target = new URL(candidate);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return null;
    }
    const targetDomain = getDomain(target.hostname) ?? target.hostname;
    return targetDomain === wrapperDomain ? null : candidate;
  } catch {
    return null;
  }
}

export function unwrapRedirect(href: string): Unwrapped | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  const domain = getDomain(hostname) ?? hostname;
  for (const redirector of redirectors) {
    if (!matchesDomain(redirector.domain, domain) || (redirector.host && !redirector.host.test(hostname)) || (redirector.path && !redirector.path.test(url.pathname))) {
      continue;
    }
    const target = asTarget(redirector.read(url), domain);
    if (target) {
      return { target, via: redirector.name };
    }
  }
  for (const [name, value] of url.searchParams) {
    if (genericParameters.has(name.toLowerCase())) {
      const target = asTarget(value, domain);
      if (target) {
        return { target, via: "A redirect inside the link" };
      }
    }
  }
  return null;
}
