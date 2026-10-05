import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer, preview } from "vite";

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[] }[];
}

const publicRoutes = ["/", "/how-it-works", "/privacy", "/terms", "/acceptable-use", "/cookies", "/accessibility", "/security", "/disclosure", "/contact", "/missing-page"];
const devOnlyRoutes = ["/design"];
const themes = ["dark", "light"] as const;
const viewports = [
  { width: 1280, height: 900, mobile: false },
  { width: 320, height: 720, mobile: true },
];
const axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const chromeStartSeconds = 60;

function chromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) {
    throw new Error("Chrome not found. Set CHROME_PATH.");
  }
  return found;
}

class Cdp {
  private nextId = 0;
  private readonly pending = new Map<number, (value: unknown) => void>();

  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: unknown };
      if (message.id !== undefined) {
        this.pending.get(message.id)?.(message.error ? Promise.reject(new Error(JSON.stringify(message.error))) : message.result);
        this.pending.delete(message.id);
      }
    });
    socket.addEventListener("close", () => {
      for (const settle of this.pending.values()) {
        settle(Promise.reject(new Error("Chrome closed the DevTools connection")));
      }
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new Cdp(socket);
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("The DevTools connection is closed"));
    }
    const id = (this.nextId += 1);
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => this.pending.set(id, resolve as (value: unknown) => void));
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send<{ result: { value: T }; exceptionDetails?: unknown }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  close(): void {
    this.socket.close();
  }
}

async function findPageTarget(profile: string): Promise<string | undefined> {
  const port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]?.trim() ?? "";
  if (!/^\d+$/.test(port)) {
    return undefined;
  }
  const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) });
  const targets = (await response.json()) as { type: string; webSocketDebuggerUrl: string }[];
  return targets.find((target) => target.type === "page")?.webSocketDebuggerUrl;
}

async function waitForChrome(chrome: ChildProcess, profile: string, output: () => string): Promise<string> {
  const deadline = Date.now() + chromeStartSeconds * 1000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null || chrome.signalCode !== null) {
      throw new Error(`Chrome exited (${chrome.exitCode ?? chrome.signalCode}) before it was ready. Its last output:\n${output()}`);
    }
    const page = await findPageTarget(profile).catch(() => undefined);
    if (page) {
      return page;
    }
    await sleep(200);
  }
  throw new Error(`Chrome did not start within ${chromeStartSeconds} seconds. Its last output:\n${output()}`);
}

async function waitFor(cdp: Cdp, condition: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      if (await cdp.evaluate<boolean>(`Boolean(${condition})`)) {
        return;
      }
    } catch {
      await sleep(50);
    }
    await sleep(50);
  }
  const state = await cdp.evaluate<string>("JSON.stringify({ path: location.pathname, ready: document.readyState, dark: document.documentElement.className, h1: document.querySelector('main h1')?.textContent ?? null, axe: typeof window.axe, root: document.getElementById('root')?.innerHTML.length ?? -1, body: document.body.innerHTML.slice(0, 120) })").catch((error: unknown) => String(error));
  throw new Error(`Timed out waiting for: ${condition}. Page state: ${state}`);
}

async function checkPage(cdp: Cdp, label: string, expectNotFound: boolean): Promise<string[]> {
  const failures: string[] = [];
  await cdp.evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 150)))");
  await cdp.evaluate(axeSource);
  const violations = await cdp.evaluate<AxeViolation[]>(
    `axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target })) })))`,
  );
  const overflow = await cdp.evaluate<number>("document.documentElement.scrollWidth - window.innerWidth");
  const title = await cdp.evaluate<string>("document.title");
  if ((title === "Page not found | ScamCam") !== expectNotFound) {
    failures.push(`${label}: rendered the wrong page (${title})`);
  }
  for (const violation of violations) {
    failures.push(`${label}: ${violation.id} (${violation.impact}) ${violation.help} at ${violation.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  }
  if (overflow > 0) {
    failures.push(`${label}: page scrolls sideways by ${overflow}px`);
  }
  console.log(`${failures.length > 0 ? "FAIL" : "pass"}  ${label}`);
  return failures;
}

async function openWithTheme(cdp: Cdp, base: string, route: string, theme: string): Promise<void> {
  await cdp.send("Page.navigate", { url: base + route });
  await waitFor(cdp, `location.pathname === ${JSON.stringify(route)} && document.readyState === "complete"`);
  await cdp.evaluate(`localStorage.setItem("scamcam-theme", "${theme}")`);
  await cdp.send("Page.reload", {});
  await waitFor(
    cdp,
    `location.pathname === ${JSON.stringify(route)} && document.readyState === "complete" && ` +
      `document.documentElement.classList.contains("dark") === ${theme === "dark"} && ` +
      `(document.querySelector("main h1")?.textContent ?? "").length > 0 && !window.axe`,
  );
}

async function audit(cdp: Cdp, base: string, routes: string[]): Promise<string[]> {
  const failures: string[] = [];
  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
    for (const theme of themes) {
      for (const route of routes) {
        await openWithTheme(cdp, base, route, theme);
        failures.push(...(await checkPage(cdp, `${route} ${theme} ${viewport.width}px`, route === "/missing-page")));
      }
    }
  }
  return failures;
}

const scanMessage = "send me your 2fa code so i can verify the trade";

async function auditReportFlow(cdp: Cdp, base: string): Promise<string[]> {
  const failures: string[] = [];
  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
    for (const theme of themes) {
      const label = `/ (report) ${theme} ${viewport.width}px`;
      await openWithTheme(cdp, base, "/", theme);
      await cdp.evaluate(
        `(() => { const box = document.querySelector("textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, ${JSON.stringify(scanMessage)}); box.dispatchEvent(new Event("input", { bubbles: true })); })()`,
      );
      try {
        await waitFor(cdp, `!document.querySelector("form button[type=submit]").disabled`);
        await cdp.evaluate(`document.querySelector("form button[type=submit]").click()`);
        await waitFor(cdp, `document.querySelector("section[aria-label=Report] #report-heading") || document.querySelector("[role=alert]")`);
      } catch (error) {
        failures.push(`${label}: the scan did not finish (${error instanceof Error ? error.message.slice(0, 120) : "unknown"})`);
        console.log(`FAIL  ${label}`);
        continue;
      }
      const alert = await cdp.evaluate<string>(`document.querySelector("[role=alert]")?.textContent ?? ""`);
      if (alert) {
        failures.push(`${label}: the scan showed an error (${alert})`);
        console.log(`FAIL  ${label}`);
        continue;
      }
      failures.push(...(await checkPage(cdp, label, false)));
    }
  }
  return failures;
}

async function withChrome<T>(run: (cdp: Cdp) => Promise<T>): Promise<T> {
  const profile = mkdtempSync(join(tmpdir(), "scamcam-a11y-"));
  const chrome: ChildProcess = spawn(
    chromePath(),
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let output = "";
  chrome.stderr?.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-2000);
  });
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  let cdp: Cdp | undefined;
  try {
    cdp = await Cdp.connect(await waitForChrome(chrome, profile, () => output));
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    return await run(cdp);
  } finally {
    cdp?.close();
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }
}

async function auditProductionBuild(): Promise<string[]> {
  process.env.NODE_ENV = "production";
  const server = await preview({ preview: { port: 4174, strictPort: true, host: "127.0.0.1" }, logLevel: "error" });
  try {
    return await withChrome(async (cdp) => [
      ...(await audit(cdp, "http://127.0.0.1:4174", publicRoutes)),
      ...(await auditReportFlow(cdp, "http://127.0.0.1:4174")),
    ]);
  } finally {
    await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  }
}

async function auditDevelopmentPages(): Promise<string[]> {
  process.env.NODE_ENV = "development";
  const server = await createServer({ mode: "development", server: { port: 5174, strictPort: true, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
  try {
    return await withChrome((cdp) => audit(cdp, "http://127.0.0.1:5174", devOnlyRoutes));
  } finally {
    await server.close();
  }
}

async function main(): Promise<void> {
  const failures = [...(await auditDevelopmentPages()), ...(await auditProductionBuild())];
  if (failures.length > 0) {
    console.error(`\n${failures.length} accessibility problem(s):\n${failures.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("\nNo WCAG 2.2 AA violations found by axe-core and no sideways scrolling.");
  }
}

await main();
process.exit(process.exitCode ?? 0);
