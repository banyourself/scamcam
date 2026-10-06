import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { preview } from "vite";
import { openPage, publicRoutes, submitScan, waitFor, withChrome } from "./browser.ts";

interface SeenRequest {
  url: string;
  method: string;
  postData?: string;
}

interface Cookie {
  name: string;
  domain: string;
  partitionKey?: unknown;
}

interface PageStorage {
  local: [string, string][];
  session: [string, string][];
  databases: string[];
  caches: string[];
  workers: number;
  cookie: string;
  href: string;
  state: string;
}

const port = 4175;
const { values: options } = parseArgs({ options: { live: { type: "string" } } });
const live = options.live !== undefined;
const base = live ? new URL(options.live!).origin : `http://127.0.0.1:${port}`;
const cloudflareCookie = /^(__cf_bm|cf_clearance|_cfuvid|__cflb|__cfruid|cf_chl_.*)$/;
const testSiteKey = /^[123]x0{20}[A-F]{2}$/;
const cloudflareCookiesSeen = new Set<string>();
const notes: string[] = [];
const turnstileOrigin = "https://challenges.cloudflare.com";
const probe = "privacy probe 7q4: send me your 2fa code at steam-trade-probe.example/probe-path-7q4 so i can verify the trade";
const probeMarkers = ["privacy probe", "7q4", "steam-trade-probe", "probe-path", "2fa code"];
const allowedStorageKeys = new Set(["scamcam-theme"]);

const hstsIsLong = (value: string) => Number(/max-age=(\d+)/.exec(value)?.[1] ?? 0) >= 31_536_000;

const sharedHeaders: [string, (value: string) => boolean][] = [
  ["strict-transport-security", hstsIsLong],
  ["x-content-type-options", (value) => value === "nosniff"],
  ["x-frame-options", (value) => value === "DENY"],
  ["referrer-policy", (value) => value === "no-referrer"],
  ["cross-origin-resource-policy", (value) => value === "same-origin"],
];

const pageHeaders: [string, (value: string) => boolean][] = [
  ...sharedHeaders,
  [
    "content-security-policy",
    (value) =>
      ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"].every((part) => value.includes(part)) &&
      !value.includes("unsafe-inline") &&
      !value.includes("unsafe-eval"),
  ],
  ["permissions-policy", (value) => ["camera=()", "microphone=()", "geolocation=()", "payment=()"].every((part) => value.includes(part))],
  ["cross-origin-opener-policy", (value) => value === "same-origin"],
  ["cache-control", (value) => value.split(",").map((part) => part.trim()).includes("no-transform") && value.split(",").filter((part) => part.trim().startsWith("max-age")).length === 1],
];

const apiHeaders: [string, (value: string) => boolean][] = [
  ...sharedHeaders,
  ["content-security-policy", (value) => value.startsWith("default-src 'none'") && value.includes("frame-ancestors 'none'")],
  ["cache-control", (value) => value === "no-store, no-transform"],
];

function headerProblems(label: string, headers: Headers, expected: [string, (value: string) => boolean][]): string[] {
  const problems: string[] = [];
  for (const [name, isGood] of expected) {
    const value = headers.get(name);
    if (value === null) {
      problems.push(`${label}: missing ${name}`);
    } else if (!isGood(value)) {
      problems.push(`${label}: unexpected ${name}: ${value}`);
    }
  }
  for (const cookie of headers.getSetCookie()) {
    const name = cookie.split("=")[0]!.trim();
    if (live && cloudflareCookie.test(name)) {
      cloudflareCookiesSeen.add(name);
    } else {
      problems.push(`${label}: sets a cookie (${name})`);
    }
  }
  for (const name of ["x-powered-by", "access-control-allow-origin"]) {
    if (headers.has(name)) {
      problems.push(`${label}: sends ${name}`);
    }
  }
  return problems;
}

async function assetPaths(): Promise<string[]> {
  const html = await (await fetch(`${base}/`)).text();
  const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  const style = /href="(\/assets\/[^"]+\.css)"/.exec(html)?.[1];
  const css = style ? await (await fetch(base + style)).text() : "";
  const font = /url\((\/assets\/[^)]+\.woff2)\)/.exec(css)?.[1];
  return [script, style, font].filter((path): path is string => path !== undefined);
}

async function checkHeaders(): Promise<string[]> {
  const assets = await assetPaths();
  const staticPaths = [
    ...publicRoutes,
    ...assets,
    "/favicon.svg",
    "/robots.txt",
    "/.well-known/security.txt",
  ];
  const failures: string[] = assets.length === 3 ? [] : [`found ${assets.length} of 3 asset paths in the page`];
  for (const path of staticPaths) {
    const response = await fetch(base + path, { redirect: "manual" });
    await response.arrayBuffer();
    if (response.status !== 200) {
      failures.push(`${path}: answered ${response.status}`);
    }
    failures.push(...headerProblems(path, response.headers, pageHeaders));
  }
  const securityTxt = await fetch(`${base}/.well-known/security.txt`);
  const securityText = await securityTxt.text();
  if (!(securityTxt.headers.get("content-type") ?? "").startsWith("text/plain")) {
    failures.push(`/.well-known/security.txt: served as ${securityTxt.headers.get("content-type")}`);
  }
  if (!/^Contact: mailto:/m.test(securityText) || !/^Policy: https:\/\/scamcam\.kevinle\.tech\/disclosure$/m.test(securityText)) {
    failures.push("/.well-known/security.txt: missing Contact or the disclosure Policy link");
  }
  const legacy = await fetch(`${base}/security.txt`, { redirect: "manual" });
  await legacy.arrayBuffer();
  if (legacy.status !== 301 || legacy.headers.get("location") !== "/.well-known/security.txt") {
    failures.push(`/security.txt: expected a permanent redirect to /.well-known/security.txt, got ${legacy.status}`);
  }
  const apiRequests: [string, RequestInit][] = [
    ["/api/v1/health", {}],
    ["/api/v1/openapi.json", {}],
    ["/api/v1/missing", {}],
    ["/api/v1/scans", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ content: "hello" }) }],
  ];
  for (const [path, init] of apiRequests) {
    const response = await fetch(base + path, { ...init, redirect: "manual" });
    await response.arrayBuffer();
    failures.push(...headerProblems(`${init.method ?? "GET"} ${path}`, response.headers, apiHeaders));
  }
  console.log(`${failures.length > 0 ? "FAIL" : "pass"}  security headers on ${staticPaths.length} static paths and ${apiRequests.length} API answers, and security.txt`);
  return failures;
}

function containsProbe(text: string): string | undefined {
  const lowered = text.toLowerCase();
  return probeMarkers.find((marker) => [marker, encodeURIComponent(marker), encodeURIComponent(marker).replaceAll("%20", "+")].some((form) => lowered.includes(form.toLowerCase())));
}

async function checkBrowser(): Promise<string[]> {
  return withChrome(async (cdp) => {
    const failures: string[] = [];
    const requests: SeenRequest[] = [];
    cdp.on("Network.requestWillBeSent", (params) => {
      requests.push(params.request as SeenRequest);
    });
    await cdp.send("Network.enable");
    await cdp.send("Network.clearBrowserCookies");

    for (const route of publicRoutes) {
      await openPage(cdp, base, route);
    }
    await openPage(cdp, base, "/");
    await cdp.evaluate(`document.querySelector('button[aria-label^="Switch to"]').click()`);
    await waitFor(cdp, `localStorage.getItem("scamcam-theme") !== null`);
    let scanned = true;
    try {
      const alert = await submitScan(cdp, probe);
      if (alert) {
        failures.push(`the scan showed an error (${alert})`);
      }
    } catch (error) {
      if (!live) {
        throw error;
      }
      scanned = false;
      notes.push("the scan step was skipped because Turnstile did not finish in a headless browser; run one scan by hand");
    }
    await sleep(1500);

    const storage = await cdp.evaluate<PageStorage>(`(async () => ({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      databases: (await indexedDB.databases()).map((database) => database.name ?? ""),
      caches: await caches.keys(),
      workers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
      cookie: document.cookie,
      href: location.href,
      state: JSON.stringify(history.state ?? null),
    }))()`);
    for (const [key, value] of storage.local) {
      if (!allowedStorageKeys.has(key)) {
        failures.push(`local storage holds an unexpected key: ${key}`);
      }
      if (containsProbe(value)) {
        failures.push(`local storage key ${key} holds submitted text`);
      }
    }
    if (storage.session.length > 0) {
      failures.push(`session storage is used: ${storage.session.map(([key]) => key).join(", ")}`);
    }
    if (storage.databases.length > 0 || storage.caches.length > 0 || storage.workers > 0) {
      failures.push(`the page created IndexedDB (${storage.databases.length}), Cache Storage (${storage.caches.length}), or service workers (${storage.workers})`);
    }
    if (storage.cookie !== "") {
      failures.push("the page can read cookies on its own origin");
    }
    if (containsProbe(storage.href) || containsProbe(storage.state)) {
      failures.push("the submitted text is in the address bar or browser history");
    }

    const cookies = await cdp
      .send<{ cookies: Cookie[] }>("Storage.getCookies")
      .catch(() => cdp.send<{ cookies: Cookie[] }>("Network.getAllCookies"));
    const siteHost = new URL(base).hostname;
    const firstParty = cookies.cookies.filter((cookie) => {
      const domain = cookie.domain.replace(/^\./, "");
      return domain === siteHost || siteHost.endsWith(`.${domain}`);
    });
    for (const cookie of firstParty) {
      if (live && cloudflareCookie.test(cookie.name)) {
        cloudflareCookiesSeen.add(cookie.name);
      } else {
        failures.push(`ScamCam's site set a cookie: ${cookie.name}`);
      }
    }

    const origins = new Set<string>();
    for (const request of requests) {
      if (/^(data|blob):/.test(request.url)) {
        continue;
      }
      const origin = new URL(request.url).origin;
      origins.add(origin);
      if (origin !== base && origin !== turnstileOrigin) {
        failures.push(`the page contacted ${origin}`);
      }
      if (origin !== base && (containsProbe(request.url) || containsProbe(request.postData ?? ""))) {
        failures.push(`submitted text was sent to ${origin}`);
      }
      if (origin === base && request.method !== "GET" && request.method !== "POST") {
        failures.push(`unexpected ${request.method} to ${request.url}`);
      }
      if (origin === base && containsProbe(request.url)) {
        failures.push(`submitted text was put in a URL: ${new URL(request.url).pathname}`);
      }
    }
    const scans = requests.filter((request) => request.url === `${base}/api/v1/scans`);
    if (!scanned) {
      return failures;
    }
    if (scans.length !== 1 || scans[0]?.method !== "POST") {
      failures.push(`expected one POST to /api/v1/scans, saw ${scans.length}`);
    } else {
      const fields = Object.keys(JSON.parse(scans[0].postData ?? "{}") as Record<string, unknown>).sort();
      if (fields.join(",") !== "content,turnstileToken") {
        failures.push(`the scan request sent unexpected fields: ${fields.join(", ")}`);
      }
    }

    console.log(`${failures.length > 0 ? "FAIL" : "pass"}  browser visit of ${publicRoutes.length} pages, a theme change, and a scan`);
    console.log(`      origins contacted: ${[...origins].sort().join(", ")}`);
    console.log(`      local storage keys: ${storage.local.map(([key]) => key).join(", ") || "none"}`);
    console.log(
      `      cookies in the browser: ${cookies.cookies.map((cookie) => `${cookie.name} (${cookie.domain}${cookie.partitionKey ? ", partitioned" : ""})`).join(", ") || "none"}`,
    );
    return failures;
  });
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function secretValues(): { name: string; value: string }[] {
  return [".dev.vars", ".dev.vars.example"]
    .filter((file) => existsSync(file))
    .flatMap((file) => readFileSync(file, "utf8").split(/\r?\n/))
    .map((line) => /^\s*([A-Z][A-Z0-9_]*)\s*=\s*"?([^"]*?)"?\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ name: match[1]!, value: match[2]! }))
    .filter(({ value }) => value.length >= 12);
}

function checkBundle(): string[] {
  const failures: string[] = [];
  const values = secretValues();
  const patterns: [string, RegExp][] = [
    ["a Google API key", /AIza[0-9A-Za-z_-]{35}/],
    ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["a GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
    ["a Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ];
  const serverOnlyNames = ["TURNSTILE_SECRET_KEY", "SAFE_BROWSING_API_KEY", "URLHAUS_AUTH_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_D1_TOKEN"];
  const files = filesUnder("dist").filter((file) => basename(file) !== ".dev.vars");
  for (const file of files) {
    const text = readFileSync(file, "latin1");
    const isPublic = file.startsWith(join("dist", "client"));
    for (const { name, value } of values) {
      if (text.includes(value)) {
        failures.push(`${file} contains the value of ${name}`);
      }
    }
    for (const [label, pattern] of patterns) {
      if (pattern.test(text)) {
        failures.push(`${file} contains ${label}`);
      }
    }
    if (isPublic) {
      for (const name of serverOnlyNames.filter((secretName) => text.includes(secretName))) {
        failures.push(`${file} mentions ${name}, which only the Worker should know`);
      }
      if (file.endsWith(".map")) {
        failures.push(`${file} is a source map in the public files`);
      }
    }
  }
  const publicNames = filesUnder(join("dist", "client")).map((file) => basename(file));
  for (const name of [".dev.vars", "wrangler.json"]) {
    if (publicNames.includes(name)) {
      failures.push(`dist/client contains ${name}`);
    }
  }
  const ignored = readFileSync(join("dist", "client", ".assetsignore"), "utf8").split(/\r?\n/);
  if (!ignored.includes(".dev.vars") || !ignored.includes("wrangler.json")) {
    failures.push("dist/client/.assetsignore does not exclude .dev.vars and wrangler.json");
  }
  console.log(`${failures.length > 0 ? "FAIL" : "pass"}  secret scan of ${files.length} built files against ${values.length} local secret values and ${patterns.length} key patterns`);
  return failures;
}

async function checkLiveApi(): Promise<string[]> {
  const failures: string[] = [];
  const health = (await (await fetch(`${base}/api/v1/health`)).json()) as { environment?: string; scanning?: string; turnstileSiteKey?: string | null };
  if (health.environment !== "production" || health.scanning !== "available") {
    failures.push(`health reports ${health.environment} and ${health.scanning}`);
  }
  if (!health.turnstileSiteKey || testSiteKey.test(health.turnstileSiteKey)) {
    failures.push("the live site uses a Turnstile test key or none");
  }
  const scan = (headers: Record<string, string>, body: string) => fetch(`${base}/api/v1/scans`, { method: "POST", headers, body });
  const missing = await scan({ "Content-Type": "application/json", Origin: base }, JSON.stringify({ content: "hello" }));
  if (missing.status !== 403) {
    failures.push(`a scan without a bot check answered ${missing.status}, not 403`);
  }
  const crossSite = await scan({ "Content-Type": "text/plain", Origin: "https://evil.example" }, JSON.stringify({ content: "hello" }));
  if (crossSite.status !== 403) {
    failures.push(`a cross-site scan answered ${crossSite.status}, not 403`);
  }
  let limited = false;
  for (let attempt = 0; attempt < 15 && !limited; attempt += 1) {
    const response = await scan({ "Content-Type": "application/json", Origin: base }, JSON.stringify({ content: "hello" }));
    await response.arrayBuffer();
    limited = response.status === 429 && response.headers.get("retry-after") !== null;
  }
  if (!limited) {
    failures.push("15 scans in a row from one address were never rate limited");
  }
  for (const site of ["https://kevinle.tech/", "https://www.kevinle.tech/"]) {
    const response = await fetch(site);
    const html = await response.text();
    if (response.status !== 200 || html.includes("ScamCam: Put scams in focus")) {
      failures.push(`${site} answered ${response.status}${html.includes("ScamCam") ? " with ScamCam's page" : ""}`);
    }
  }
  console.log(`${failures.length > 0 ? "FAIL" : "pass"}  live API: production settings, bot check required, cross-site posts refused, rate limit, personal site unchanged`);
  return failures;
}

async function main(): Promise<void> {
  if (live) {
    const failures = [...(await checkHeaders()), ...(await checkLiveApi()), ...(await checkBrowser())];
    report(failures);
    return;
  }
  process.env.NODE_ENV = "production";
  const failures = checkBundle();
  const server = await preview({ preview: { port, strictPort: true, host: "127.0.0.1", cors: false }, logLevel: "error" });
  try {
    failures.push(...(await checkHeaders()), ...(await checkBrowser()));
  } finally {
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }
  report(failures);
}

function report(failures: string[]): void {
  if (cloudflareCookiesSeen.size > 0) {
    console.log(`      cookies set by Cloudflare's own security features: ${[...cloudflareCookiesSeen].sort().join(", ")}`);
  }
  for (const note of notes) {
    console.log(`note: ${note}`);
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} privacy or security problem(s):\n${failures.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("\nNo tracking, no stray storage, no leaked secrets, and every response sends the security headers.");
  }
}

await main();
process.exit(process.exitCode ?? 0);
