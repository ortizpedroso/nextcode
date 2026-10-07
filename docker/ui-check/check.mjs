// Roteiro FIXO (sem IA): para cada página e viewport, abre, espera a rede acalmar, tira print e
// coleta erros de console, exceções da página, respostas HTTP com erro e rolagem horizontal no celular.
import { chromium } from "playwright";
import fs from "node:fs";

const pages = JSON.parse(process.env.UI_CHECK_PAGES || '["/"]');
const base = "http://127.0.0.1:3000";
const viewports = [
  { name: "celular", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false, hasTouch: false },
];

const browser = await chromium.launch();
const results = [];
for (const route of pages) {
  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.hasTouch,
    });
    const page = await ctx.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const httpErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 500)); });
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 500)));
    page.on("response", (r) => {
      if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) httpErrors.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    });

    const slug = (route.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home") + `-${vp.name}`;
    let status = null;
    let navError = null;
    try {
      const resp = await page.goto(base + route, { waitUntil: "networkidle", timeout: 30000 });
      status = resp ? resp.status() : null;
    } catch (e) {
      navError = String(e).slice(0, 300);
    }
    let horizontalOverflowPx = 0;
    let visibleText = "";
    if (!navError) {
      horizontalOverflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
      visibleText = (await page.evaluate(() => document.body.innerText || "")).slice(0, 400);
      await page.screenshot({ path: `/out/${slug}.png`, fullPage: true });
    }
    results.push({
      route, viewport: vp.name, status, navError, consoleErrors, pageErrors, httpErrors,
      horizontalOverflowPx, visibleText, screenshot: navError ? null : `${slug}.png`,
    });
    await ctx.close();
  }
}
await browser.close();

const problems = results.flatMap((r) => [
  ...(r.navError ? [`${r.route} (${r.viewport}): não abriu — ${r.navError}`] : []),
  ...(r.status && r.status >= 400 ? [`${r.route} (${r.viewport}): HTTP ${r.status}`] : []),
  ...r.pageErrors.map((e) => `${r.route} (${r.viewport}): exceção na página — ${e}`),
  ...r.consoleErrors.map((e) => `${r.route} (${r.viewport}): erro no console — ${e}`),
  ...r.httpErrors.map((e) => `${r.route} (${r.viewport}): requisição com erro — ${e}`),
  ...(r.viewport === "celular" && r.horizontalOverflowPx > 1 ? [`${r.route} (celular): rolagem horizontal de ${r.horizontalOverflowPx}px`] : []),
]);
fs.writeFileSync("/out/report.json", JSON.stringify({ ok: problems.length === 0, stage: "browser", problems, results }, null, 1));
