// Automated browser QA against disposable fixtures and real loopback emulators.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
if (process.env.GCLOUD_PROJECT !== "demo-wedding-security" || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099") {
  throw new Error("Browser QA requires the demo-project Auth and Firestore emulators.");
}
const { chromium, webkit } = await import(process.env.GENDER_REVEAL_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.GENDER_REVEAL_PLAYWRIGHT_MODULE).href : "playwright");
const root = resolve(".");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".mp3": "audio/mpeg" };
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
  const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(`${root}\\`) && !file.startsWith(`${root}/`)) { res.writeHead(403); res.end(); return; }
  try { const data = await readFile(file); res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(4173, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:4173";
const runId = process.env.GENDER_REVEAL_BROWSER_RUN_ID;
const eventId = `gr-browser-event-${runId}`;
const password = process.env.GENDER_REVEAL_TEST_PASSWORD;
await mkdir(".local-evidence", { recursive: true });
const results = [];
try {
  const engines = process.env.GENDER_REVEAL_BROWSER_ENGINE === "webkit" ? [[webkit, true]] : [[chromium, false], [chromium, true]];
  for (const [engine, mobile] of engines) {
    // Reset only this synthetic event; production endpoints cannot be selected.
    await import(`../tests/fixtures/seed-gender-reveal-browser.mjs?run=${Date.now()}`);
    const browser = await engine.launch({ ...(engine === chromium ? { channel: "chrome" } : {}), headless: true });
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 1000 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}), reducedMotion: "reduce" });
    // WebKit's Windows port stalls on the emulator dashboard's streaming
    // transport. Keep the authorized observer in Chrome while testing the real
    // mobile WebKit invitation, Auth, transaction, reload, and retry behavior.
    const observerBrowser = mobile ? await chromium.launch({ channel: "chrome", headless: true }) : browser;
    const observerContext = mobile ? await observerBrowser.newContext({ viewport: { width: 1365, height: 1000 } }) : context;
    const engineName = engine === chromium ? (mobile ? "chromium-mobile-emulation" : "chromium-desktop") : "webkit-mobile-emulation";
    context.on("page", page => page.on("pageerror", error => console.log(`${engineName} page error: ${error.message}`)));
    try {
      const dashboard = await observerContext.newPage();
      await dashboard.goto(`${origin}/customer-login.html?wedding=${eventId}&emulator=1`);
      await dashboard.getByLabel("Email", { exact: true }).fill(`gr-customer-a-${runId}@example.test`);
      await dashboard.locator('input[type="password"]').fill(password);
      await dashboard.getByRole("button", { name: "Sign in", exact: true }).click();
      await dashboard.waitForURL(/customer-events\.html|dashboard\.html/);
      await dashboard.goto(`${origin}/dashboard.html?wedding=${eventId}&emulator=1`);
      const goResponses = async () => {
        await dashboard.locator("#dashboardApp").waitFor({ state: "visible" });
        await dashboard.getByRole("button", { name: "Responses", exact: true }).click();
      };
      await goResponses();
      await dashboard.getByText("No responses have been submitted yet.", { exact: true }).waitFor();
      const openForm = async page => {
        await page.goto(`${origin}/gender-reveal.html?wedding=${eventId}&emulator=1`);
        await page.getByRole("button", { name: "Open invitation", exact: true }).click();
        await page.locator("#fullName").waitFor({ state: "visible" });
      };
      const fill = async (page, name, prediction = "boy", attendance = "attending") => {
        await page.locator("#fullName").fill(name);
        await page.locator(`label:has(input[name="attendance"][value="${attendance}"])`).click();
        await page.locator(`label:has(input[name="prediction"][value="${prediction}"])`).click();
      };
      const guest = await context.newPage();
      await openForm(guest);
      const name = `QA ${engineName} first`;
      await fill(guest, name);
      // Two dispatched submit events exercise the real synchronous UI guard.
      await guest.locator("#responseForm").evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
      await guest.locator("#thankYou").waitFor({ state: "visible" });
      await dashboard.getByText(name, { exact: true }).first().waitFor();
      await guest.locator("#resultTotal").filter({ hasText: "1 prediction" }).waitFor();
      assert.equal(await guest.locator("#resultTotal").innerText(), "1 prediction");
      await guest.reload();
      await guest.getByRole("button", { name: "Open invitation", exact: true }).click();
      await fill(guest, "Reload attempt", "girl");
      await guest.locator("#submitResponse").click();
      await guest.locator("#formStatus").filter({ hasText: "has already submitted" }).waitFor();
      assert.equal(await guest.locator("#fullName").inputValue(), "Reload attempt");
      assert.equal(await guest.locator("#thankYou").isVisible(), false);

      const retry = await context.newPage();
      await openForm(retry);
      const retryName = `QA ${engineName} network retry`;
      await fill(retry, retryName, "girl", "not_attending");
      await retry.locator("#message").fill("Synthetic message after a network interruption");
      // Cut real Firestore HTTP requests while leaving Auth and the page usable.
      const blockFirestore = route => route.abort("internetdisconnected");
      await retry.route(/127\.0\.0\.1:8080/, blockFirestore);
      await retry.locator("#submitResponse").click();
      await retry.locator("#formStatus").filter({ hasText: /network|connection|could not save/i }).waitFor({ timeout: 60000 });
      assert.equal(await retry.locator("#fullName").inputValue(), retryName);
      assert.equal(await retry.locator("#thankYou").isVisible(), false);
      await retry.unroute(/127\.0\.0\.1:8080/, blockFirestore);
      await retry.locator("#submitResponse").click();
      await retry.locator("#thankYou").waitFor({ state: "visible" });
      await dashboard.getByText(retryName, { exact: true }).first().waitFor();
      await retry.locator("#resultTotal").filter({ hasText: "2 predictions" }).waitFor();
      assert.equal(await retry.locator("#resultTotal").innerText(), "2 predictions");
      await dashboard.reload();
      await goResponses();
      await dashboard.getByText(name, { exact: true }).first().waitFor();
      await dashboard.getByText(retryName, { exact: true }).first().waitFor();
      assert.match(await dashboard.locator("body").innerText(), new RegExp(`gr-customer-a-${runId}@example.test`), "invitation Auth must not replace the customer session");
      await retry.screenshot({ path: `.local-evidence/gender-reveal-${engineName}-saved.png`, fullPage: true });
      await dashboard.screenshot({ path: `.local-evidence/gender-reveal-${engineName}-dashboard.png`, fullPage: true });
      results.push({ engine: engineName, dashboardEngine: "chromium", firstResponse: true, doubleSubmit: true, reloadDuplicate: true, networkRetry: true, liveDashboardListener: true, dashboardReload: true, ...(mobile ? {} : { customerAuthIsolation: true }) });
      console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
      for (const page of context.pages()) console.log(JSON.stringify({ engineName, url: page.url(), body: await page.locator("body").innerText().catch(() => "unavailable") }));
      for (const [i, page] of context.pages().entries()) await page.screenshot({ path: `.local-evidence/gender-reveal-${engineName}-failure-${i}.png`, fullPage: true }).catch(() => {});
      throw error;
    } finally { await browser.close(); if (observerBrowser !== browser) await observerBrowser.close(); }
  }
} finally { server.close(); }
