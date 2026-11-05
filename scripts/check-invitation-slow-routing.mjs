// Browser regression for slow guest routing. Seed a synthetic Moonlit fixture in the local emulators first.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright');
const fixture = JSON.parse(await readFile('.local-evidence/moonlit-fixture.json', 'utf8'));
const guest = fixture.events['moonlit-local-preview'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => sessionStorage.setItem('wedding:localEmulators', '1'));
  const page = await context.newPage(), prematureArtwork = [], errors = [];
  page.on('request', request => { if (page.url().includes('/index.html?wedding=') && new URL(request.url()).pathname.startsWith('/images/')) prematureArtwork.push(new URL(request.url()).pathname); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => ['127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 500000 / 8, uploadThroughput: 500000 / 8 });
  const start = Date.now();
  await page.goto(`http://127.0.0.1:5173/index.html?wedding=moonlit-local-preview&emulator=1#guest=${guest.token}&recipient=${guest.guestId}`, { waitUntil: 'commit' });
  await page.waitForURL(/moonlit-conservatory/, { timeout: 60000, waitUntil: 'commit' });
  const routedMs = Date.now() - start;
  await page.locator('#skipOpening').waitFor({ timeout: 60000 });
  assert.deepEqual(prematureArtwork, [], 'generic artwork must not consume bandwidth before design selection');
  assert.deepEqual(errors, []);
  console.log(`PASS slow guest link routed to Moonlit in ${routedMs} ms; no generic artwork requested before routing`);
} finally { await browser.close(); }
