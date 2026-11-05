// Browser regression for the loading state while a personal invitation is routed.
// Run against the loopback emulator preview with PLAYWRIGHT_MODULE pointing to an existing Playwright installation.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const playwright = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import('playwright');
const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.pathname === '/script.js' || url.pathname === '/invitations/router.js') return route.abort();
    return route.continue();
  });
  await page.goto('http://127.0.0.1:5173/index.html?wedding=synthetic-event&emulator=1#guest=synthetic-token', { waitUntil: 'domcontentloaded' });
  const status = page.locator('#invitation-route-loading');
  assert.equal(await status.isVisible(), true, 'the loading message is visible during routing');
  assert.equal(await status.getAttribute('role'), 'status');
  assert.match(await status.innerText(), /Preparing your invitation/);
  await page.evaluate(() => { document.documentElement.style.visibility = ''; });
  assert.equal(await status.isVisible(), false, 'the message disappears once the invitation is ready');
  await page.unroute('**/*');
  await page.goto('http://127.0.0.1:5173/index.html?demo=1&emulator=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.querySelector('img[data-invitation-src]'));
  const artwork = page.locator('.envelope-layer');
  assert.equal(await artwork.count(), 6);
  await page.waitForFunction(() => [...document.querySelectorAll('.envelope-layer')].every(image => image.complete && image.naturalWidth > 1 && !image.hidden));
  console.log('PASS generic invitation artwork loads after routing');
  console.log('PASS invitation routing shows and clears an accessible loading message');
} finally { await browser.close(); }
