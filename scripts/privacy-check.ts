import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { preview } from "vite";
import { ocrBase } from "../src/shared/ocr.ts";
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
const qrCard = readFileSync(new URL("../test/fixtures/qr-card.png", import.meta.url)).toString("base64");
const qrCardLink = "https://www.linkedin.com/in/kevin-example/";
const screenshotTraces = [qrCard.slice(4000, 4064), "kevin-example", "cybersecurity club", "steam-trade-probe", "discord-gift-probe"];
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
      !(/script-src ([^;]+)/.exec(value)?.[1] ?? "").split(" ").includes("'unsafe-eval'"),
  ],
  ["permissions-policy", (value) => ["camera=()", "microphone=()", "geolocation=()", "payment=()"].every((part) => value.includes(part))],
  ["cross-origin-opener-policy", (value) => value === "same-origin"],
  ["cache-control", (value) => value.split(",").filter((part) => part.trim().startsWith("max-age")).length === 1],
];

const noTransform = (value: string | null) => (value ?? "").split(",").map((part) => part.trim()).includes("no-transform");

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
    const transformBlocked = noTransform(response.headers.get("cache-control"));
    if (publicRoutes.includes(path) && !transformBlocked) {
      failures.push(`${path}: a page must send no-transform so Cloudflare cannot inject scripts`);
    }
    if (path.startsWith("/assets/") && transformBlocked) {
      failures.push(`${path}: scripts and styles should allow compression, so no no-transform`);
    }
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
    let flagged = false;
    if (scanned && !live) {
      try {
        const button = (label: string) => `[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === ${JSON.stringify(label)})`;
        await cdp.evaluate(`${button("Flag result as incorrect")}.click()`);
        await waitFor(cdp, `[...document.querySelectorAll("legend")].some((legend) => legend.textContent === "What is wrong?")`);
        await cdp.evaluate(`document.querySelector('input[type="radio"][value="detail_wrong"]').click()`);
        await cdp.evaluate(
          `(() => { const note = document.querySelector('textarea[aria-describedby$="note-help"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(note, "privacy probe note, reach me at probe@example.com"); note.dispatchEvent(new Event("input", { bubbles: true })); })()`,
        );
        await waitFor(cdp, `${button("Send for review")} && !${button("Send for review")}.disabled`);
        await cdp.evaluate(`${button("Send for review")}.click()`);
        await waitFor(cdp, `document.body.textContent.includes("A person will review this report.")`);
        flagged = true;
      } catch (error) {
        failures.push(`flagging the report failed (${error instanceof Error ? error.message.slice(0, 120) : "unknown"})`);
      }
    }
    let shareKey = "";
    if (scanned) {
      try {
        await cdp.evaluate(`[...document.querySelectorAll("button")].find((button) => button.textContent.includes("Make share link")).click()`);
        await waitFor(cdp, `document.querySelector("input[readonly]")?.value?.includes("/r/")`);
        const shareUrl = await cdp.evaluate<string>(`document.querySelector("input[readonly]").value`);
        shareKey = shareUrl.split("#")[1] ?? "";
        await cdp.send("Page.navigate", { url: shareUrl });
        await waitFor(cdp, `document.querySelector("#report-heading") && document.body.textContent.includes("A report someone shared")`);
        if (!(await cdp.evaluate<boolean>(`document.body.textContent.includes("did not include the message text")`))) {
          failures.push("the shared report showed the message although it was not included");
        }
        if (await cdp.evaluate<boolean>(`document.body.textContent.toLowerCase().includes("privacy probe")`)) {
          failures.push("the shared report contains the message text");
        }
      } catch (error) {
        failures.push(`sharing the report failed (${error instanceof Error ? error.message.slice(0, 120) : "unknown"})`);
      }
    }

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
    if (shareKey && requests.some((request) => request.url.includes(shareKey) || (request.postData ?? "").includes(shareKey))) {
      failures.push("the share key was sent to a server");
    }
    const scans = requests.filter((request) => request.url === `${base}/api/v1/scans`);
    if (scanned && (scans.length !== 1 || scans[0]?.method !== "POST")) {
      failures.push(`expected one POST to /api/v1/scans, saw ${scans.length}`);
    } else if (scanned) {
      const fields = Object.keys(JSON.parse(scans[0]?.postData ?? "{}") as Record<string, unknown>).sort();
      if (fields.join(",") !== "content,turnstileToken") {
        failures.push(`the scan request sent unexpected fields: ${fields.join(", ")}`);
      }
    }
    const flags = requests.filter((request) => request.url === `${base}/api/v1/flags`);
    if (flagged && (flags.length !== 1 || flags[0]?.method !== "POST")) {
      failures.push(`expected one POST to /api/v1/flags, saw ${flags.length}`);
    } else if (flagged) {
      const fields = Object.keys(JSON.parse(flags[0]?.postData ?? "{}") as Record<string, unknown>).sort();
      if (fields.join(",") !== "note,reason,report,signature,turnstileToken") {
        failures.push(`the flag request sent unexpected fields: ${fields.join(", ")}`);
      }
    }

    console.log(`${failures.length > 0 ? "FAIL" : "pass"}  browser visit of ${publicRoutes.length} pages, a theme change${scanned ? `, a scan,${flagged ? " a flag sent for review," : ""} and a share link opened like a friend would` : ""}`);
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
    ["a Google API key", /(?<![A-Za-z0-9+/_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/],
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

const screenshotScript = `(() => {
  window.__violations = [];
  document.addEventListener("securitypolicyviolation", (event) => window.__violations.push(event.violatedDirective + " " + event.blockedURI));
  window.__paste = async (kind, keep = "") => {
    let file;
    if (kind === "light" || kind === "dark") {
      const canvas = document.createElement("canvas");
      canvas.width = 1100;
      canvas.height = 260;
      const context = canvas.getContext("2d");
      context.fillStyle = kind === "light" ? "#ffffff" : "#1e1f22";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = kind === "light" ? "#111111" : "#dbdee1";
      context.font = "40px Arial, sans-serif";
      context.fillText(kind === "light" ? "hey bro send me your 2fa code" : "free nitro gift for you", 40, 100);
      context.fillText(kind === "light" ? "verify at steam-trade-probe.example" : "claim at discord-gift-probe.example", 40, 180);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      file = new File([blob], "shot.png", { type: "image/png" });
    } else if (kind === "qrcard") {
      const bytes = Uint8Array.from(atob(window.__qrCard), (char) => char.charCodeAt(0));
      file = new File([bytes], "card.png", { type: "image/png" });
    } else if (kind === "svg") {
      file = new File(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><text>hi</text></svg>'], "shot.svg", { type: "image/svg+xml" });
    } else {
      file = new File(["<script>alert(1)</script> not really a picture"], "shot.png", { type: "image/png" });
    }
    const data = new DataTransfer();
    data.items.add(file);
    const box = document.querySelector("textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, keep);
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    box.focus();
    box.select();
    box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  };
})()`;

const fileScript = `(() => {
  window.__stageFile = () => {
    const bytes = new Uint8Array(4096);
    bytes.set([0x4d, 0x5a]);
    bytes.set([0x80, 0, 0, 0], 0x3c);
    bytes.set([0x50, 0x45, 0, 0], 0x80);
    bytes.set([0x02, 0x01], 0x80 + 22);
    bytes.set(new TextEncoder().encode("fingerprint-probe-content"), 2048);
    const file = new File([bytes], "Invoice 2026.pdf.exe", { type: "application/octet-stream" });
    const data = new DataTransfer();
    data.items.add(file);
    document.querySelector("textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  };
})()`;

async function checkFileCheck(): Promise<string[]> {
  return withChrome(async (cdp) => {
    const failures: string[] = [];
    const requests: SeenRequest[] = [];
    cdp.on("Network.requestWillBeSent", (params) => {
      requests.push(params.request as SeenRequest);
    });
    await cdp.send("Network.enable");
    await openPage(cdp, base, "/");
    await cdp.evaluate(fileScript);
    await cdp.evaluate("window.__stageFile()");
    const card = `document.querySelector('section[aria-label="File to check"]')?.textContent ?? ""`;
    try {
      await waitFor(cdp, `${card}.includes("Windows program (.exe)")`);
    } catch {
      failures.push(`the file was not looked at on the device (${JSON.stringify((await cdp.evaluate<string>(card)).slice(0, 160))})`);
    }
    const leaked = (request: SeenRequest) => ["fingerprint-probe-content", "Invoice 2026", "Invoice%202026"].some((trace) => request.url.includes(trace) || (request.postData ?? "").includes(trace));
    if (requests.some((request) => request.url === `${base}/api/v1/files`)) {
      failures.push("the file was checked before the button was pressed");
    }
    let checked = false;
    if (!live) {
      const before = requests.length;
      await waitFor(cdp, `[...document.querySelectorAll("button")].some((button) => button.textContent === "Check this file" && !button.disabled)`);
      await cdp.evaluate(`[...document.querySelectorAll("button")].find((button) => button.textContent === "Check this file").click()`);
      await waitFor(cdp, `document.querySelector("section[aria-label=Report] #report-heading") || document.querySelector("[role=alert]")`);
      const report = await cdp.evaluate<string>(`document.querySelector("section[aria-label=Report]")?.textContent ?? document.querySelector("[role=alert]")?.textContent ?? ""`);
      if (!report.includes("Hides its real type behind a fake ending")) {
        failures.push(`the file report missed the disguised ending (${report.replace(/\s+/g, " ").slice(0, 300)})`);
      }
      const sent = requests.slice(before).find((request) => request.url === `${base}/api/v1/files`);
      const fields = Object.keys(JSON.parse(sent?.postData ?? "{}") as Record<string, unknown>).sort();
      if (fields.join(",") !== "extension,findings,kind,sha1,sha256,size,turnstileToken") {
        failures.push(`the file check sent unexpected fields: ${fields.join(", ") || "none"}`);
      }
      checked = true;
    }
    for (const request of requests) {
      if (leaked(request)) {
        failures.push(`the file's name or contents reached ${new URL(request.url).origin}`);
      }
    }
    console.log(`${failures.length > 0 ? "FAIL" : "pass"}  a file looked at on the device${checked ? " and checked by fingerprint only" : ""}, with no name or contents sent`);
    return failures;
  });
}

const modScript = `(() => {
  window.__stageMod = () => {
    const encoder = new TextEncoder();
    const le16 = (value) => [value & 255, (value >>> 8) & 255];
    const le32 = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
    const files = [
      ["META-INF/MANIFEST.MF", encoder.encode("Manifest-Version: 1.0\\n")],
      ["fabric.mod.json", encoder.encode(JSON.stringify({ schemaVersion: 1, id: "probemod", version: "1.0.0", description: "jar-probe-content" }))],
    ];
    const locals = [];
    const central = [];
    let offset = 0;
    for (const [name, data] of files) {
      const encoded = encoder.encode(name);
      const local = [0x50, 0x4b, 3, 4, ...le16(20), ...le16(0x800), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(data.length), ...le32(data.length), ...le16(encoded.length), 0, 0, ...encoded, ...data];
      central.push(0x50, 0x4b, 1, 2, ...le16(20), ...le16(20), ...le16(0x800), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(data.length), ...le32(data.length), ...le16(encoded.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le32(offset), ...encoded);
      locals.push(...local);
      offset += local.length;
    }
    const end = [0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...le16(files.length), ...le16(files.length), ...le32(central.length), ...le32(offset), 0, 0];
    const file = new File([new Uint8Array([...locals, ...central, ...end])], "Secret Plans 2026.jar", { type: "application/java-archive" });
    const data = new DataTransfer();
    data.items.add(file);
    document.querySelector("textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  };
})()`;

async function checkModFile(): Promise<string[]> {
  return withChrome(async (cdp) => {
    const failures: string[] = [];
    const requests: SeenRequest[] = [];
    cdp.on("Network.requestWillBeSent", (params) => {
      requests.push(params.request as SeenRequest);
    });
    await cdp.send("Network.enable");
    await openPage(cdp, base, "/");
    await cdp.evaluate(modScript);
    await cdp.evaluate("window.__stageMod()");
    const card = `document.querySelector('section[aria-label="File to check"]')?.textContent ?? ""`;
    try {
      await waitFor(cdp, `${card}.includes("Calls itself the mod: probemod")`);
    } catch {
      failures.push(`the mod was not looked at on the device (${JSON.stringify((await cdp.evaluate<string>(card)).slice(0, 160))})`);
    }
    let checked = false;
    if (!live) {
      const before = requests.length;
      await waitFor(cdp, `[...document.querySelectorAll("button")].some((button) => button.textContent === "Check this file" && !button.disabled)`);
      await cdp.evaluate(`[...document.querySelectorAll("button")].find((button) => button.textContent === "Check this file").click()`);
      await waitFor(cdp, `document.querySelector("section[aria-label=Report] #report-heading") || document.querySelector("[role=alert]")`);
      const sent = requests.slice(before).find((request) => request.url === `${base}/api/v1/files`);
      const body = JSON.parse(sent?.postData ?? "{}") as Record<string, unknown>;
      if (Object.keys(body).sort().join(",") !== "extension,findings,kind,modId,sha1,sha256,size,turnstileToken" || body.modId !== "probemod") {
        failures.push(`the mod check sent unexpected fields: ${Object.keys(body).sort().join(", ") || "none"}`);
      }
      checked = true;
    }
    for (const request of requests) {
      if (["Secret Plans", "Secret%20Plans", "jar-probe-content"].some((trace) => request.url.includes(trace) || (request.postData ?? "").includes(trace))) {
        failures.push(`the mod's file name or contents reached ${new URL(request.url).origin}`);
      }
    }
    console.log(`${failures.length > 0 ? "FAIL" : "pass"}  a Minecraft mod looked at on the device${checked ? " and checked by fingerprint and mod ID only" : ""}, with no name or contents sent`);
    return failures;
  });
}

const emailScript = `(() => {
  window.__stageEmail = () => {
    const program = new Uint8Array(1024);
    program.set([0x4d, 0x5a]);
    program.set([0x80, 0, 0, 0], 0x3c);
    program.set([0x50, 0x45, 0, 0], 0x80);
    program.set([0x02, 0x01], 0x80 + 22);
    program.set(new TextEncoder().encode("attachment-probe-content"), 512);
    const lines = [
      "Authentication-Results: mx.example.net; spf=fail smtp.mailfrom=probe-sender-local@steam-security-alert.example; dkim=none; dmarc=fail header.from=steam-security-alert.example",
      "From: Steam Support <probe-sender-local@steam-security-alert.example>",
      "To: probe.victim@example.org",
      "Subject: Your account will be locked",
      "Content-Type: multipart/mixed; boundary=b",
      "",
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Verify your account at https://steam-login.example/verify within 24 hours.",
      "--b",
      "Content-Type: application/octet-stream",
      "Content-Disposition: attachment; filename=probe-attachment-name.pdf.exe",
      "Content-Transfer-Encoding: base64",
      "",
      btoa(String.fromCharCode(...program)),
      "--b--",
      "",
    ];
    const file = new File([lines.join("\\r\\n")], "Locked account.eml", { type: "message/rfc822" });
    const data = new DataTransfer();
    data.items.add(file);
    document.querySelector("textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  };
})()`;

async function checkEmailFile(): Promise<string[]> {
  return withChrome(async (cdp) => {
    const failures: string[] = [];
    const requests: SeenRequest[] = [];
    cdp.on("Network.requestWillBeSent", (params) => {
      requests.push(params.request as SeenRequest);
    });
    await cdp.send("Network.enable");
    await openPage(cdp, base, "/");
    await cdp.evaluate(emailScript);
    await cdp.evaluate("window.__stageEmail()");
    const details = `document.querySelector('section[aria-label="Email details"]')?.textContent ?? ""`;
    try {
      await waitFor(cdp, `document.querySelector("textarea").value.includes("Subject: Your account will be locked") && (${details}).includes("DMARC fail")`);
    } catch {
      failures.push(`the email was not read on the device (${JSON.stringify((await cdp.evaluate<string>(details)).slice(0, 160))})`);
    }
    if (requests.some((request) => request.url === `${base}/api/v1/scans`)) {
      failures.push("the email was checked before the button was pressed");
    }
    let checked = false;
    if (!live) {
      await waitFor(cdp, `!document.querySelector("form button[type=submit]").disabled`);
      const before = requests.length;
      await cdp.evaluate(`document.querySelector("form button[type=submit]").click()`);
      await waitFor(cdp, `document.querySelector("section[aria-label=Report] #report-heading") || document.querySelector("[role=alert]")`);
      const report = await cdp.evaluate<string>(`document.querySelector("section[aria-label=Report]")?.textContent ?? document.querySelector("[role=alert]")?.textContent ?? ""`);
      if (!report.includes("failed its sender check") || !report.includes("Attachment 1")) {
        failures.push(`the email report missed the faked sender or the attachment (${report.replace(/\s+/g, " ").slice(0, 300)})`);
      }
      const sent = JSON.parse(requests.slice(before).find((request) => request.url === `${base}/api/v1/scans`)?.postData ?? "{}") as { email?: Record<string, unknown> };
      const fields = Object.keys(sent).sort().join(",");
      const emailFields = Object.keys(sent.email ?? {}).sort().join(",");
      if (fields !== "content,email,turnstileToken" || emailFields !== "attachments,dkim,dmarc,fromDomain,replyToDiffers,spf") {
        failures.push(`the email scan sent unexpected fields: ${fields} / ${emailFields}`);
      }
      checked = true;
    }
    const traces = ["probe-sender-local", "probe.victim", "probe-attachment-name", "attachment-probe-content"];
    for (const request of requests) {
      if (traces.some((trace) => request.url.includes(trace) || (request.postData ?? "").includes(trace))) {
        failures.push(`an email address or attachment reached ${new URL(request.url).origin}`);
      }
    }
    console.log(`${failures.length > 0 ? "FAIL" : "pass"}  an email file read on the device${checked ? " and checked" : ""}, with no address, recipient, or attachment sent`);
    return failures;
  });
}

async function checkScreenshots(): Promise<string[]> {
  return withChrome(async (cdp) => {
    const failures: string[] = [];
    const requests: SeenRequest[] = [];
    cdp.on("Network.requestWillBeSent", (params) => {
      requests.push(params.request as SeenRequest);
    });
    const workers: string[] = [];
    cdp.on("Target.attachedToTarget", (params) => {
      const sessionId = params.sessionId as string;
      workers.push((params.targetInfo as { url: string }).url);
      void cdp
        .send("Network.enable", {}, sessionId)
        .then(() => cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId))
        .catch(() => undefined);
    });
    await cdp.send("Network.enable");
    await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await openPage(cdp, base, "/");
    await cdp.evaluate(screenshotScript);
    await cdp.evaluate(`window.__qrCard = ${JSON.stringify(qrCard)}`);
    const box = `document.querySelector("textarea").value.toLowerCase()`;
    for (const [kind, expected] of [
      ["light", "steam-trade-probe.example"],
      ["dark", "discord-gift-probe.example"],
    ] as const) {
      await cdp.evaluate(`window.__paste(${JSON.stringify(kind)})`);
      try {
        await waitFor(cdp, `${box}.includes(${JSON.stringify(expected)})`);
      } catch {
        const value = await cdp.evaluate<string>(`${box}.slice(0, 200)`);
        const alert = await cdp.evaluate<string>(`document.querySelector("[role=alert]")?.textContent ?? ""`);
        failures.push(`the ${kind} screenshot was not read (box: ${JSON.stringify(value)}, alert: ${JSON.stringify(alert)})`);
      }
    }
    await cdp.evaluate(`window.__paste("light", "replace-me-old-text")`);
    try {
      await waitFor(cdp, `${box}.includes("steam-trade-probe.example")`);
      if ((await cdp.evaluate<string>(box)).includes("replace-me-old-text")) {
        failures.push("a screenshot pasted over selected text kept the old text");
      }
      await cdp.evaluate(`[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Clear text").click()`);
      await waitFor(cdp, `${box} === "" && document.activeElement === document.querySelector("textarea")`);
    } catch {
      failures.push("pasting a screenshot over selected text, or the Clear text button, did not work");
    }
    await cdp.evaluate(`window.__paste("qrcard")`);
    try {
      await waitFor(cdp, `${box}.includes(${JSON.stringify(`qr code: ${qrCardLink}`)})`);
      const read = await cdp.evaluate<string>(`document.querySelector("textarea").value`);
      const stray = read.split("\n").filter((line) => line.trim() !== "" && !/[a-z]{3}/i.test(line));
      if (stray.length > 0) {
        failures.push(`the QR code was also read as stray text: ${JSON.stringify(stray)}`);
      }
    } catch {
      failures.push("the QR code card was not read");
    }
    for (const kind of ["svg", "fake"]) {
      await cdp.evaluate(`window.__paste(${JSON.stringify(kind)})`);
      await waitFor(cdp, `document.querySelector("[role=alert]")?.textContent?.includes("Only PNG, JPEG, WebP, and GIF")`).catch(() => failures.push(`the ${kind} file was not refused`));
      if ((await cdp.evaluate<string>(box)) !== "") {
        failures.push(`the ${kind} file put text in the box`);
      }
    }
    const violations = await cdp.evaluate<string[]>("window.__violations");
    if (violations.length > 0) {
      failures.push(`content security policy violations: ${violations.join(", ")}`);
    }
    const storage = await cdp.evaluate<{ databases: number; caches: number; local: string[] }>(
      `(async () => ({ databases: (await indexedDB.databases()).length, caches: (await caches.keys()).length, local: Object.keys(localStorage) }))()`,
    );
    if (storage.databases > 0 || storage.caches > 0 || storage.local.some((key) => key !== "scamcam-theme")) {
      failures.push("reading a screenshot stored something in the browser");
    }
    for (const request of requests) {
      if (/^(data|blob):/.test(request.url)) {
        continue;
      }
      const url = new URL(request.url);
      if (url.origin !== base && url.origin !== turnstileOrigin) {
        failures.push(`reading a screenshot contacted ${url.origin}`);
      }
      const body = request.postData ?? "";
      if (body.length > 50_000 && url.origin !== turnstileOrigin) {
        failures.push(`reading a screenshot sent ${body.length} bytes to ${url.origin}${url.pathname.slice(0, 40)}`);
      }
      if (screenshotTraces.some((trace) => body.includes(trace) || request.url.includes(trace))) {
        failures.push(`reading a screenshot sent its content to ${url.origin}${url.pathname.slice(0, 40)}`);
      }
      if (request.method !== "GET" && url.origin !== turnstileOrigin && !(url.origin === base && url.pathname.startsWith("/cdn-cgi/challenge-platform/"))) {
        failures.push(`reading a screenshot sent a ${request.method} to ${url.pathname}`);
      }
    }
    if (!workers.some((url) => url.endsWith(`${ocrBase}/worker.min.js`))) {
      failures.push(`the OCR worker was not seen (${workers.join(", ") || "no workers"})`);
    }
    let scannedCard = false;
    if (!live) {
      await cdp.evaluate(`window.__paste("qrcard")`);
      await waitFor(cdp, `${box}.includes(${JSON.stringify(qrCardLink)})`);
      await waitFor(cdp, `!document.querySelector("form button[type=submit]").disabled`);
      const before = requests.length;
      await cdp.evaluate(`document.querySelector("form button[type=submit]").click()`);
      await waitFor(cdp, `document.querySelector("section[aria-label=Report] #report-heading") || document.querySelector("[role=alert]")`);
      const report = await cdp.evaluate<string>(`document.querySelector("section[aria-label=Report]")?.textContent ?? document.querySelector("[role=alert]")?.textContent ?? ""`);
      if (report.includes("Asks you to scan a QR code") || report.includes("QR code login takeover")) {
        failures.push(`a harmless QR code from a screenshot was reported as a QR code login scam (${report.replace(/\s+/g, " ").slice(0, 400)})`);
      }
      const scan = requests.slice(before).find((request) => request.url === `${base}/api/v1/scans`);
      const fields = Object.keys(JSON.parse(scan?.postData ?? "{}") as Record<string, unknown>).sort();
      if (fields.join(",") !== "content,fromScreenshot,turnstileToken") {
        failures.push(`the screenshot scan sent unexpected fields: ${fields.join(", ") || "none"}`);
      }
      scannedCard = true;
    }
    const ocrFetches = requests.filter((request) => request.url.includes("/ocr/")).map((request) => new URL(request.url).pathname);
    console.log(
      `${failures.length > 0 ? "FAIL" : "pass"}  screenshots read on the device (light, dark, and a QR code card${scannedCard ? " that was then scanned" : ""}), SVG and fake images refused, nothing uploaded or stored`,
    );
    console.log(`      OCR files fetched: ${[...new Set(ocrFetches)].join(", ") || "none seen"}`);
    return failures;
  });
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
    if (response.status !== 200 || html.includes("ScamCam - Check the Scan")) {
      failures.push(`${site} answered ${response.status}${html.includes("ScamCam") ? " with ScamCam's page" : ""}`);
    }
  }
  console.log(`${failures.length > 0 ? "FAIL" : "pass"}  live API: production settings, bot check required, cross-site posts refused, rate limit, personal site unchanged`);
  return failures;
}

async function main(): Promise<void> {
  if (live) {
    const failures = [...(await checkHeaders()), ...(await checkLiveApi()), ...(await checkBrowser()), ...(await checkScreenshots()), ...(await checkFileCheck()), ...(await checkModFile()), ...(await checkEmailFile())];
    report(failures);
    return;
  }
  process.env.NODE_ENV = "production";
  const failures = checkBundle();
  const server = await preview({ preview: { port, strictPort: true, host: "127.0.0.1", cors: false }, logLevel: "error" });
  try {
    failures.push(...(await checkHeaders()), ...(await checkBrowser()), ...(await checkScreenshots()), ...(await checkFileCheck()), ...(await checkModFile()), ...(await checkEmailFile()));
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
