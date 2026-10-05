import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const debugPort = 9341;

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

async function waitForDebugger(): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = targets.find((target) => target.type === "page");
      if (page) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Chrome did not start");
}

async function waitFor(cdp: Cdp, condition: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if (await cdp.evaluate<boolean>(`Boolean(${condition})`)) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const state = await cdp.evaluate<string>("JSON.stringify({ path: location.pathname, ready: document.readyState, dark: document.documentElement.className, h1: document.querySelector('main h1')?.textContent ?? null, axe: typeof window.axe, root: document.getElementById('root')?.innerHTML.length ?? -1, body: document.body.innerHTML.slice(0, 120) })").catch((error: unknown) => String(error));
  throw new Error(`Timed out waiting for: ${condition}. Page state: ${state}`);
}

async function audit(cdp: Cdp, base: string, routes: string[]): Promise<string[]> {
  const failures: string[] = [];
  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
    for (const theme of themes) {
      for (const route of routes) {
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
        await cdp.evaluate("document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 150)))");
        await cdp.evaluate(axeSource);
        const violations = await cdp.evaluate<AxeViolation[]>(
          `axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target })) })))`,
        );
        const overflow = await cdp.evaluate<number>("document.documentElement.scrollWidth - window.innerWidth");
        const title = await cdp.evaluate<string>("document.title");
        const label = `${route} ${theme} ${viewport.width}px`;
        if ((title === "Page not found | ScamCam") !== (route === "/missing-page")) {
          failures.push(`${label}: rendered the wrong page (${title})`);
        }
        for (const violation of violations) {
          failures.push(`${label}: ${violation.id} (${violation.impact}) ${violation.help} at ${violation.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
        }
        if (overflow > 0) {
          failures.push(`${label}: page scrolls sideways by ${overflow}px`);
        }
        console.log(`${failures.some((failure) => failure.startsWith(label)) ? "FAIL" : "pass"}  ${label}`);
      }
    }
  }
  return failures;
}

async function withChrome<T>(run: (cdp: Cdp) => Promise<T>): Promise<T> {
  const profile = mkdtempSync(join(tmpdir(), "scamcam-a11y-"));
  const chrome: ChildProcess = spawn(
    chromePath(),
    ["--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"],
    { stdio: "ignore" },
  );
  const cdp = await Cdp.connect(await waitForDebugger());
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    return await run(cdp);
  } finally {
    cdp.close();
    chrome.kill();
  }
}

async function auditProductionBuild(): Promise<string[]> {
  process.env.NODE_ENV = "production";
  const server = await preview({ preview: { port: 4174, strictPort: true, host: "127.0.0.1" }, logLevel: "error" });
  try {
    return await withChrome((cdp) => audit(cdp, "http://127.0.0.1:4174", publicRoutes));
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
