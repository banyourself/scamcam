import { readFileSync } from "node:fs";
import { createServer, preview } from "vite";
import { publicRoutes, submitScan, waitFor, withChrome, type Cdp } from "./browser.ts";

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[] }[];
}

const devOnlyRoutes = ["/design"];
const themes = ["dark", "light"] as const;
const viewports = [
  { width: 1280, height: 900, mobile: false },
  { width: 320, height: 720, mobile: true },
];
const axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");

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
      let alert: string;
      try {
        alert = await submitScan(cdp, scanMessage);
      } catch (error) {
        failures.push(`${label}: the scan did not finish (${error instanceof Error ? error.message.slice(0, 120) : "unknown"})`);
        console.log(`FAIL  ${label}`);
        continue;
      }
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
