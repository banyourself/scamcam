import { getDomain, parse } from "tldts";
import {
  archiveExtensions,
  brands,
  commonBrandWords,
  communitySites,
  executableExtensions,
  freeHostOf,
  hostLurePrefixes,
  hostLureWords,
  userContentHosts,
  ipLoggers,
  loginQrLinks,
  deviceLoginLinks,
  officialBrandFor,
  riskyPathWords,
  riskyTldSource,
  riskyTlds,
  urlShorteners,
  type Brand,
} from "./brands";
import { editDistance, hasNonAscii, scriptsIn, skeleton } from "./confusables";
import { hostnameToUnicode } from "./punycode";
import { sourceNames, type Signal } from "./signals";

export interface AnalyzedLink {
  original: string;
  href: string | null;
  hostname: string | null;
  displayHostname: string | null;
  registrableDomain: string | null;
  isIp: boolean;
  isPrivateSuffix: boolean;
  officialBrand: Brand | null;
  communitySite: string | null;
  brandsMentioned: Brand[];
  signals: Signal[];
  discordInvite: string | null;
  steamAccount: SteamRef | null;
  githubRef: GithubRef | null;
}

export type SteamRef = { kind: "id"; value: string } | { kind: "vanity"; value: string };

export interface GithubRef {
  owner: string;
  repo: string | null;
}

const steamIdBase = 76561197960265728n;
const discordInviteHosts = new Set(["discord.com", "www.discord.com", "ptb.discord.com", "canary.discord.com", "discordapp.com", "www.discordapp.com"]);

function discordInviteCode(hostname: string, url: URL): string | null {
  const path = url.pathname;
  const code = hostname === "discord.gg" || hostname === "www.discord.gg" ? /^\/([A-Za-z0-9-]{2,32})\/?$/.exec(path)?.[1] : discordInviteHosts.has(hostname) ? /^\/invite\/([A-Za-z0-9-]{2,32})\/?$/.exec(path)?.[1] : undefined;
  return code ?? null;
}

function steamAccountRef(hostname: string, url: URL): SteamRef | null {
  if (hostname !== "steamcommunity.com" && hostname !== "www.steamcommunity.com") {
    return null;
  }
  const profile = /^\/profiles\/(7656119\d{10})(?:\/|$)/.exec(url.pathname)?.[1];
  if (profile) {
    return { kind: "id", value: profile };
  }
  const vanity = /^\/id\/([A-Za-z0-9_-]{2,32})(?:\/|$)/.exec(url.pathname)?.[1];
  if (vanity) {
    return { kind: "vanity", value: vanity };
  }
  const partner = /^\/tradeoffer\/new\/?$/.test(url.pathname) ? url.searchParams.get("partner") : null;
  if (partner && /^\d{1,10}$/.test(partner) && Number(partner) > 0) {
    return { kind: "id", value: (steamIdBase + BigInt(partner)).toString() };
  }
  return null;
}

const githubOwnerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const githubRepoPattern = /^[A-Za-z0-9._-]{1,100}$/;
const githubRoutes = new Set([
  "about", "account", "apps", "blog", "business", "codespaces", "collections", "contact", "copilot", "customer-stories",
  "dashboard", "education", "enterprise", "events", "explore", "features", "git-guides", "home", "issues", "join", "login",
  "logout", "marketplace", "mobile", "new", "nonprofit", "notifications", "organizations", "orgs", "partners", "pricing",
  "pulls", "readme", "resources", "search", "security", "sessions", "settings", "signup", "site", "solutions", "sponsors",
  "stars", "team", "topics", "trending", "users", "watching",
]);

function githubRefFrom(hostname: string, url: URL): GithubRef | null {
  const parts = url.pathname.split("/").filter((part) => part !== "");
  let owner: string | undefined;
  let repo: string | undefined;
  if (hostname === "github.com" || hostname === "www.github.com") {
    [owner, repo] = parts;
  } else if (hostname === "raw.githubusercontent.com" || hostname === "codeload.github.com") {
    [owner, repo] = parts;
    if (!repo) {
      return null;
    }
  } else if (/^[a-z0-9-]+\.github\.io$/.test(hostname)) {
    owner = hostname.slice(0, -".github.io".length);
  } else {
    return null;
  }
  if (!owner || !githubOwnerPattern.test(owner) || githubRoutes.has(owner.toLowerCase())) {
    return null;
  }
  const name = repo?.replace(/\.git$/i, "");
  if (name === undefined) {
    return { owner, repo: null };
  }
  return githubRepoPattern.test(name) && name !== "." && name !== ".." ? { owner, repo: name } : null;
}

const schemePattern = /^[a-z][a-z0-9+.-]*:\/\//i;

function signal(link: string, partial: Omit<Signal, "source" | "link">): Signal {
  return { source: sourceNames.domain, link, ...partial };
}

function lookalikeThreshold(label: string): number {
  if (label.length >= 9) {
    return 2;
  }
  return label.length >= 5 ? 1 : 0;
}

function brandLabelsTouched(hostname: string, brand: Brand): boolean {
  const forms = [hostname, skeleton(hostname)];
  return forms.some((form) => {
    const parts = form.split(/[.-]/);
    return brand.tokens.some((token) => {
      const target = form === hostname ? token : skeleton(token);
      return token.length >= 5 ? form.includes(target) : parts.some((part) => part === target || (part.startsWith(target) && /^\d+$/.test(part.slice(target.length))));
    });
  });
}

type LookalikeMatch = { brand: Brand; rank: number; signal: Omit<Signal, "source" | "link"> };

function officialDomainFor(brand: Brand, label: string): string {
  return brand.officialDomains.find((domain) => domain.startsWith(`${label}.`)) ?? brand.officialDomains[0]!;
}

function findLookalike(label: string, unicodeLabel: string, registrable: string): LookalikeMatch | null {
  const matches: LookalikeMatch[] = [];
  const consider = (match: LookalikeMatch) => matches.push(match);
  const parts = unicodeLabel.includes("-") ? unicodeLabel.split("-").filter((part) => part.length >= 5) : [];
  const realAddress = hostnameToUnicode(registrable);
  for (const brand of brands) {
    for (const official of brand.lookalikeLabels) {
      const officialDomain = officialDomainFor(brand, official);
      const officialSkeleton = skeleton(official);
      const distinctive = !commonBrandWords.has(official);
      const base = { direction: "raises" as const, brandId: brand.id, lookalike: true };
      if (skeleton(unicodeLabel) === officialSkeleton && hasNonAscii(unicodeLabel)) {
        consider({
          brand,
          rank: 4,
          signal: {
            ...base,
            id: `homograph-${registrable}`,
            strength: "critical",
            title: `Disguised to look like ${officialDomain}`,
            detail: `The address uses letters from another alphabet so that "${realAddress}" looks like ${officialDomain}. The real address is ${registrable}.`,
          },
        });
      } else if (label === official) {
        consider({
          brand,
          rank: 3,
          signal: {
            ...base,
            id: `wrong-ending-${registrable}`,
            strength: "strong",
            title: `Uses ${brand.name}'s name with a different ending`,
            detail: `${registrable} is not ${officialDomain}. ${brand.name} does not use this address.`,
          },
        });
      } else if (editDistance(skeleton(unicodeLabel), officialSkeleton) <= lookalikeThreshold(official)) {
        consider({
          brand,
          rank: 2,
          signal: {
            ...base,
            id: `lookalike-${registrable}`,
            strength: "strong",
            title: `Spelled almost like ${officialDomain}`,
            detail: `${realAddress} is a near copy of ${officialDomain}, the real ${brand.name} address. Scam sites often change one or two letters.`,
          },
        });
      }
      for (const part of parts) {
        const partSkeleton = skeleton(part);
        const disguised = part !== official && partSkeleton === officialSkeleton;
        const copied = distinctive && (part === official || (official.length >= 9 && editDistance(partSkeleton, officialSkeleton) <= 2));
        if (disguised || copied) {
          consider({
            brand,
            rank: disguised && hasNonAscii(part) ? 4 : disguised ? 2 : 1,
            signal: {
              ...base,
              id: `name-copy-${registrable}`,
              strength: disguised && hasNonAscii(part) ? "critical" : "strong",
              title: disguised ? `Hides a misspelled "${official}" in the address` : `Copies the name of ${officialDomain}`,
              detail: `${realAddress} uses "${part}" to look like ${officialDomain}, but it belongs to someone else.`,
            },
          });
        }
      }
    }
  }
  return matches.reduce<LookalikeMatch | null>((best, match) => (!best || match.rank > best.rank ? match : best), null);
}

function startsWithOfficial(hostname: string): { brand: Brand; domain: string } | null {
  for (const brand of brands) {
    for (const domain of brand.officialDomains) {
      if (hostname.startsWith(`${domain}.`) || hostname.startsWith(`${domain}-`)) {
        return { brand, domain };
      }
    }
  }
  return null;
}

function subdomainBrand(subdomain: string): { brand: Brand; label: string; official: boolean } | null {
  const labels = subdomain.split(".").flatMap((label) => [label, ...(label.includes("-") ? label.split("-") : [])]).filter(Boolean);
  let found: { brand: Brand; label: string; official: boolean } | null = null;
  for (const brand of brands) {
    for (const label of labels) {
      const official = brand.lookalikeLabels.includes(label) && !commonBrandWords.has(label);
      if (official) {
        return { brand, label, official };
      }
      if (!found && (brand.lookalikeLabels.includes(label) || (label.length >= 5 && brand.tokens.includes(label)))) {
        found = { brand, label, official };
      }
    }
  }
  return found;
}

const lureNames: Record<string, string> = { verif: "verify", recover: "recovery" };

function hostLure(name: string, brand: Brand): string | null {
  const text = brand.tokens.reduce((rest, token) => rest.split(token).join(" "), name);
  const parts = text.split(/[^a-z0-9]+/).filter(Boolean);
  const word =
    hostLureWords.find((candidate) => text.includes(candidate)) ??
    hostLurePrefixes.find((candidate) => parts.some((part) => part.startsWith(candidate) || part.endsWith(candidate)));
  return word ? (lureNames[word] ?? word) : null;
}

function lastExtension(pathname: string): string | null {
  const last = pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : null;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function analyzeLink(original: string): AnalyzedLink {
  const result: AnalyzedLink = {
    original,
    href: null,
    hostname: null,
    displayHostname: null,
    registrableDomain: null,
    isIp: false,
    isPrivateSuffix: false,
    officialBrand: null,
    communitySite: null,
    brandsMentioned: [],
    signals: [],
    discordInvite: null,
    steamAccount: null,
    githubRef: null,
  };
  const explicitHttp = /^http:\/\//i.test(original);
  let url: URL;
  try {
    url = new URL(schemePattern.test(original) ? original : `http://${original}`);
  } catch {
    result.signals.push(
      signal(original, {
        id: `unreadable-${original}`,
        direction: "context",
        strength: "weak",
        title: "Part of this looks like a link but could not be read",
        detail: "ScamCam could not understand this address, so it could not check it.",
      }),
    );
    return result;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return result;
  }

  const hostname = url.hostname.toLowerCase();
  const parsed = parse(hostname, { allowPrivateDomains: true });
  const registrable = parsed.domain ?? hostname;
  const icannDomain = getDomain(hostname);
  result.href = url.href;
  result.hostname = hostname;
  result.displayHostname = hostnameToUnicode(hostname);
  result.registrableDomain = registrable;
  result.isIp = Boolean(parsed.isIp) || hostname.startsWith("[");
  result.isPrivateSuffix = Boolean(parsed.isPrivate);
  result.officialBrand = officialBrandFor(registrable) ?? officialBrandFor(icannDomain);
  result.communitySite = communitySites[registrable] ? registrable : null;
  result.discordInvite = discordInviteCode(hostname, url);
  result.steamAccount = steamAccountRef(hostname, url);
  result.githubRef = githubRefFrom(hostname, url);
  result.brandsMentioned = brands.filter((brand) => brandLabelsTouched(hostname, brand));

  const add = (partial: Omit<Signal, "source" | "link">) => result.signals.push(signal(hostname, partial));

  if (url.username || url.password) {
    const hidden = safeDecode(url.username).toLowerCase();
    const disguised = brands.find((brand) => brand.officialDomains.some((domain) => hidden.includes(domain)) || brandLabelsTouched(hidden, brand));
    add({
      id: `userinfo-${hostname}`,
      direction: "raises",
      strength: disguised ? "critical" : "strong",
      title: disguised ? `Pretends to be ${disguised.name} with an @ trick` : "Hides the real address with an @ trick",
      detail: `Everything before the @ in a link is ignored. This link really goes to ${result.displayHostname}.`,
      brandId: disguised?.id,
    });
  }

  const loginQr = result.officialBrand && loginQrLinks.some((entry) => entry.domain === registrable && entry.path.test(url.pathname));
  if (loginQr && result.officialBrand) {
    const name = result.officialBrand.name;
    add({
      id: `login-qr-${registrable}`,
      direction: "raises",
      strength: "critical",
      family: "qr_takeover",
      title: `This is a ${name} login QR code`,
      detail: `Opening or scanning it with the ${name} app logs whoever made it into your account. ${name} only shows login QR codes on its own login page, never in a message.`,
      brandId: result.officialBrand.id,
    });
  } else if (result.officialBrand && deviceLoginLinks.some((entry) => entry.domain === registrable && entry.path.test(url.pathname))) {
    const name = result.officialBrand.name;
    add({
      id: `device-login-${registrable}`,
      direction: "raises",
      strength: "strong",
      family: "credential_theft",
      title: `This is ${name}'s page for signing in a device with a code`,
      detail: `Typing a code someone sent you on this page signs their device into your ${name} account, including Xbox and Minecraft. Only enter a code shown on your own TV, console, or app.`,
      brandId: result.officialBrand.id,
    });
  } else if (result.officialBrand && result.discordInvite) {
    add({
      id: `discord-invite-${registrable}`,
      direction: "context",
      strength: "weak",
      title: "This is an invite to a Discord server",
      detail: "Anyone can make a Discord server and an invite to it, so an invite on discord.gg does not show that the server is safe or official.",
    });
  } else if (result.officialBrand) {
    add({
      id: `official-${registrable}`,
      direction: "lowers",
      strength: "strong",
      title: `${registrable} belongs to ${result.officialBrand.name}`,
      detail: `This is one of the addresses ${result.officialBrand.name} uses. Pages on official sites can still be posted by other people, such as profiles or uploads.`,
      brandId: result.officialBrand.id,
    });
  } else if (result.communitySite) {
    add({
      id: `community-${registrable}`,
      direction: "lowers",
      strength: "weak",
      title: `${registrable} is ${communitySites[registrable]}`,
      detail: "It is not run by the game company, but it is widely used and well known.",
    });
  }

  if (ipLoggers.has(registrable)) {
    add({
      id: `iplogger-${registrable}`,
      direction: "raises",
      strength: "strong",
      title: "This is an IP-logging link",
      detail: `${registrable} records the IP address and device of anyone who opens it. It is often used to track or threaten people.`,
    });
  } else if (urlShorteners.has(registrable)) {
    add({
      id: `shortener-${registrable}`,
      direction: "raises",
      strength: "weak",
      title: "A short link hides where it really goes",
      detail: `${registrable} links forward you to another site. ScamCam does not open links, so it cannot see the final address.`,
    });
  }

  if (result.isIp) {
    add({
      id: `ip-host-${hostname}`,
      direction: "raises",
      strength: "moderate",
      title: "Uses a raw IP address instead of a name",
      detail: "Real game and chat services use named addresses. Links to bare IP addresses are common in scams and malware.",
    });
  }

  const freeHost = freeHostOf(hostname);
  let brandRelated = false;

  if (!result.officialBrand && !result.communitySite && !result.isIp) {
    const label = parsed.domainWithoutSuffix ?? "";
    const unicodeLabel = hostnameToUnicode(label);
    const lookalike = label ? findLookalike(label, unicodeLabel, registrable) : null;
    const prefix = startsWithOfficial(hostname);
    const inSubdomain = parsed.subdomain ? subdomainBrand(parsed.subdomain) : null;
    if (lookalike) {
      brandRelated = true;
      add(lookalike.signal);
    } else if (prefix) {
      brandRelated = true;
      add({
        id: `prefix-${hostname}`,
        direction: "raises",
        strength: "strong",
        title: `Starts with ${prefix.domain} but is a different site`,
        detail: `The address begins with ${prefix.domain} to look official, but the site it really belongs to is ${registrable}.`,
        brandId: prefix.brand.id,
        lookalike: true,
      });
    } else if (inSubdomain?.official) {
      brandRelated = true;
      add({
        id: `subdomain-brand-${hostname}`,
        direction: "raises",
        strength: "strong",
        title: `Puts "${inSubdomain.label}" in front of a different site's address`,
        detail: `The address starts with ${inSubdomain.label} to look like ${officialDomainFor(inSubdomain.brand, inSubdomain.label)}, but the site it really belongs to is ${registrable}.`,
        brandId: inSubdomain.brand.id,
        lookalike: true,
      });
    } else if (inSubdomain) {
      brandRelated = true;
      add({
        id: `subdomain-brand-${hostname}`,
        direction: "raises",
        strength: "moderate",
        title: `Puts ${inSubdomain.brand.name}'s name in front of a different site's address`,
        detail: `"${inSubdomain.label}" is only a name the owner of ${registrable} picked. Communities sometimes do this for their own pages, and fake login and gift pages do it to look official.`,
        brandId: inSubdomain.brand.id,
      });
    } else if (result.brandsMentioned.length > 0) {
      brandRelated = true;
      const names = result.brandsMentioned.map((brand) => brand.name).join(" and ");
      add({
        id: `brand-mention-${hostname}`,
        direction: "raises",
        strength: freeHost ? "moderate" : "weak",
        title: `Mentions ${names} but is not an official ${names} site`,
        detail: `${registrable} is not owned by ${names}. Many fan sites are harmless, but scam sites also use game names to look trustworthy.`,
        brandId: result.brandsMentioned[0]!.id,
      });
    }

    const lureBrand = lookalike?.brand ?? prefix?.brand ?? inSubdomain?.brand ?? result.brandsMentioned[0];
    const lure = brandRelated && lureBrand ? hostLure(hostname.slice(0, hostname.length - (parsed.publicSuffix?.length ?? 0)), lureBrand) : null;
    if (lure && lureBrand) {
      add({
        id: `brand-lure-${hostname}`,
        direction: "raises",
        strength: "moderate",
        title: `Pairs ${lureBrand.name}'s name with "${lure}" in the address`,
        detail: `Addresses that join a game or app name with words like gift, free, login, or verify are a common way to make fake gift, login, and support pages look official. ${registrable} does not belong to ${lureBrand.name}.`,
        brandId: lureBrand.id,
      });
    }

    if (hasNonAscii(result.displayHostname ?? "") && !lookalike) {
      const mixed = (result.displayHostname ?? "").split(".").some((part) => scriptsIn(part).length > 1);
      add({
        id: `idn-${hostname}`,
        direction: "raises",
        strength: mixed ? "moderate" : "weak",
        title: mixed ? "Mixes letters from different alphabets" : "Uses international characters",
        detail: `The address is written as ${result.displayHostname} but its real form is ${hostname}. Mixed alphabets are a common way to imitate real sites.`,
      });
    }
  }

  if (freeHost && !result.officialBrand) {
    add({
      id: `free-host-${hostname}`,
      direction: "raises",
      strength: brandRelated ? "moderate" : "weak",
      title: `Hosted on ${freeHost}, which anyone can use for free`,
      detail: `Free hosting is used by many honest projects, and also by scam pages that disappear and reappear quickly.`,
    });
  }

  const pathText = `${url.pathname}${url.search}`.toLowerCase();
  const pathWords = pathText.split(/[^a-z0-9-]+/).filter(Boolean);
  const riskyWord = riskyPathWords.find((word) => pathWords.includes(word) || pathWords.some((part) => part.startsWith(word) && word.length >= 5));
  if (riskyWord && !result.officialBrand && (brandRelated || freeHost)) {
    add({
      id: `risky-path-${hostname}`,
      direction: "raises",
      strength: "moderate",
      title: `The page is about "${riskyWord}" on a site that is not official`,
      detail: "Fake login, gift, and trade pages are the most common way gaming accounts are stolen.",
    });
  }

  const extension = lastExtension(url.pathname);
  const userContent = userContentHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  if (extension && executableExtensions.includes(extension) && (!result.officialBrand || userContent)) {
    add({
      id: `executable-${hostname}-${extension}`,
      direction: "raises",
      strength: "strong",
      title: `Downloads a program (.${extension})${userContent ? " that someone uploaded" : ""}`,
      detail: userContent
        ? "Anyone can upload files to this service, so an official address does not make the file safe. Programs sent in chats are a common way accounts are stolen."
        : "Programs from links can take over your computer and steal saved passwords. Only install software from the official store or developer.",
    });
  } else if (extension && archiveExtensions.includes(extension) && (!result.officialBrand || userContent)) {
    add({
      id: `archive-${hostname}-${extension}`,
      direction: "raises",
      strength: "weak",
      title: `Downloads a compressed file (.${extension})`,
      detail: "Compressed files are often used to sneak programs past warnings.",
    });
  }

  if (!result.officialBrand) {
    if (explicitHttp) {
      add({
        id: `no-https-${hostname}`,
        direction: "raises",
        strength: "weak",
        title: "Does not use a secure connection",
        detail: "The link starts with http:// instead of https://, so anything you type could be read by others on the network.",
      });
    }
    if (url.port && url.port !== "80" && url.port !== "443") {
      add({
        id: `port-${hostname}`,
        direction: "raises",
        strength: "weak",
        title: `Uses an unusual port (${url.port})`,
        detail: "Normal websites rarely use custom ports in links.",
      });
    }
    if ((parsed.subdomain ?? "").split(".").filter(Boolean).length >= 4) {
      add({
        id: `deep-subdomain-${hostname}`,
        direction: "raises",
        strength: "weak",
        title: "Has an unusually long chain of subdomains",
        detail: "Long chains of names before the real domain are often used to push the real address out of view.",
      });
    }
    const suffix = parsed.publicSuffix ?? "";
    if (riskyTlds.has(suffix) && !result.communitySite && !result.isIp) {
      add({
        id: `risky-tld-${registrable}`,
        direction: "raises",
        strength: "weak",
        sourceUrl: riskyTldSource,
        title: `Uses the .${suffix} ending, one of the most abused for phishing`,
        detail: `Interisle's 2025 phishing study ranks .${suffix} among the endings with the most phishing for their size. Plenty of honest sites use it too, so this is only a small warning sign.`,
      });
    }
  }

  return result;
}
