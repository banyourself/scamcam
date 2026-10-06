import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const publicRoutes = ["/", "/how-it-works", "/privacy", "/terms", "/acceptable-use", "/cookies", "/accessibility", "/security", "/disclosure", "/contact", "/missing-page"];

const chromeStartSeconds = 60;

type Listener = (params: Record<string, unknown>) => void;

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

export class Cdp {
  private nextId = 0;
  private readonly pending = new Map<number, (value: unknown) => void>();
  private readonly listeners = new Map<string, Listener[]>();

  private readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: unknown; method?: string; params?: Record<string, unknown> };
      if (message.id !== undefined) {
        this.pending.get(message.id)?.(message.error ? Promise.reject(new Error(JSON.stringify(message.error))) : message.result);
        this.pending.delete(message.id);
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) {
          listener(message.params ?? {});
        }
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

  on(method: string, listener: Listener): void {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
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

export async function waitFor(cdp: Cdp, condition: string): Promise<void> {
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

export async function openPage(cdp: Cdp, base: string, route: string): Promise<void> {
  await cdp.send("Page.navigate", { url: base + route });
  await waitFor(cdp, `location.pathname === ${JSON.stringify(route)} && document.readyState === "complete" && (document.querySelector("main h1")?.textContent ?? "").length > 0`);
}

export async function submitScan(cdp: Cdp, message: string): Promise<string> {
  await cdp.evaluate(
    `(() => { const box = document.querySelector("textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, ${JSON.stringify(message)}); box.dispatchEvent(new Event("input", { bubbles: true })); })()`,
  );
  await waitFor(cdp, `!document.querySelector("form button[type=submit]").disabled`);
  await cdp.evaluate(`document.querySelector("form button[type=submit]").click()`);
  await waitFor(cdp, `document.querySelector("section[aria-label=Report] #report-heading") || document.querySelector("[role=alert]")`);
  return cdp.evaluate<string>(`document.querySelector("[role=alert]")?.textContent ?? ""`);
}

export async function withChrome<T>(run: (cdp: Cdp) => Promise<T>): Promise<T> {
  const profile = mkdtempSync(join(tmpdir(), "scamcam-browser-"));
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
