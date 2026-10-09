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
      const emailLabel = `/ (email details) ${theme} ${viewport.width}px`;
      await cdp.evaluate(
        `(() => { const text = ["Authentication-Results: mx.example.net; spf=fail; dkim=none; dmarc=fail", "From: Steam Support <a@steam-security-alert.example>", "Subject: Locked", "", "Verify now."].join("\\r\\n"); const data = new DataTransfer(); data.items.add(new File([text], "mail.eml", { type: "message/rfc822" })); document.querySelector("textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); })()`,
      );
      try {
        await waitFor(cdp, `Boolean(document.querySelector('section[aria-label="Email details"]'))`);
        failures.push(...(await checkPage(cdp, emailLabel, false)));
      } catch {
        failures.push(`${emailLabel}: the email details did not appear`);
        console.log(`FAIL  ${emailLabel}`);
      }
      const flagLabel = `/ (report, flag form) ${theme} ${viewport.width}px`;
      const opened = await cdp.evaluate<boolean>(
        `(() => { const button = [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === "Flag result as incorrect"); button?.click(); return Boolean(button); })()`,
      );
      if (!opened) {
        failures.push(`${flagLabel}: the report has no flag button`);
        console.log(`FAIL  ${flagLabel}`);
        continue;
      }
      await waitFor(cdp, `[...document.querySelectorAll("legend")].some((legend) => legend.textContent === "What is wrong?")`);
      failures.push(...(await checkPage(cdp, flagLabel, false)));
    }
  }
  return failures;
}

const statusText = `[...document.querySelectorAll('[role="status"]')].map((node) => node.textContent).join(" ")`;

function typeInto(selector: string, value: string): string {
  return `(() => { const box = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(box, ${JSON.stringify(value)}); box.dispatchEvent(new Event("input", { bubbles: true })); })()`;
}

function pressButton(label: string): string {
  return `[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === ${JSON.stringify(label)}).click()`;
}

async function auditBreachFlow(cdp: Cdp, base: string): Promise<string[]> {
  const failures: string[] = [];
  for (const viewport of viewports) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
    for (const theme of themes) {
      const label = `/breaches (answers) ${theme} ${viewport.width}px`;
      await openWithTheme(cdp, base, "/breaches", theme);
      try {
        await cdp.evaluate(typeInto('input[type="password"]', "accessibility check password"));
        await cdp.evaluate(pressButton("Check password"));
        await waitFor(cdp, `/appeared in data breaches|not found in any known breach|could not be reached|a lot of passwords/.test(${statusText})`);
        await cdp.evaluate(typeInto('input[type="search"]', "adobe"));
        await cdp.evaluate(pressButton("Search"));
        await waitFor(cdp, `/breach(es)? match|has no leaked data from|could not be loaded/.test(${statusText})`);
        await cdp.evaluate(typeInto('input[type="password"]', "accessibility check password"));
        await waitFor(cdp, `/Strength:|could not load/.test(document.body.textContent)`);
        await cdp.evaluate(pressButton("Make a passphrase"));
        await waitFor(cdp, `/bits of randomness/.test(document.body.textContent)`);
        await cdp.evaluate(`document.querySelectorAll("details").forEach((details) => { details.open = true; })`);
      } catch (error) {
        failures.push(`${label}: the checks did not finish (${error instanceof Error ? error.message.slice(0, 120) : "unknown"})`);
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
      ...(await auditBreachFlow(cdp, "http://127.0.0.1:4174")),
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
