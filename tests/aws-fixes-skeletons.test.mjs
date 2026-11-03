import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { skeleton, busyNote } from "../skeleton.js";
import { ONLINE_ATTEMPTS, waitOnline } from "../photo-bucket/transport.js";

const read = f => readFile(new URL(`../${f}`, import.meta.url), "utf8");

test("one shared skeleton style: shapes for cards, rows, tiles and text, with reduced motion and no inline script", async () => {
  for (const html of [skeleton.cards(2), skeleton.rows(2), skeleton.tiles(2), skeleton.lines(3)]) {
    assert.match(html, /role="status" aria-busy="true"/); assert.match(html, /sr-only/); assert.doesNotMatch(html, /<script|onclick|style=/);
  }
  assert.equal((skeleton.cards(3).match(/sk-card"/g) || []).length, 3);
  const css = await read("skeleton.css");
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(busyNote("x"), /sk-busy/);
  for (const page of ["customer-events.html", "all-events.html", "clients.html", "customers.html", "dashboard.html", "photo-bucket.html", "photo-bucket-manage.html"]) assert.match(await read(page), /skeleton\.css/, page);
});

test("every list and gallery shows a skeleton while loading", async () => {
  const need = { "weddings.js": /skeleton\.cards/, "admin-workspace.js": /skeleton\.cards[\s\S]*skeleton\.rows[\s\S]*Loading activity/, "clients.js": /skeleton\.rows[\s\S]*skeleton\.lines/, "customers.js": /skeleton\.rows/, "customer-link.js": /skeleton\.lines/, "dashboard.js": /skeleton\.cards\(3, "Loading the overview/, "photo-bucket/app.js": /skeleton\.tiles/, "client-notes.js": /skeleton\.rows/ };
  for (const [file, pattern] of Object.entries(need)) assert.match(await read(file), pattern, file);
  assert.equal((await read("photo-bucket/app.js")).match(/skeleton\.tiles\(6\)/g).length, 2, "owner and guest gallery");
});

test("D7: joining a bucket waits out Retry-After and shows a busy state, never a dead page", async () => {
  const a = await read("photo-bucket/adapter-api.js"), app = await read("photo-bucket/app.js");
  assert.match(a, /patientCall\('POST', `\/b\/\$\{bucketId\}\/guest`/); assert.match(a, /patientCall\('GET', `\/b\/\$\{bucketId\}\/public`\)/);
  assert.match(a, /error\.retryAfter, 120\) \* 1000/); assert.match(a, /export const onBusy/);
  assert.match(app, /Busy, joining shortly/);
});

test("D8: uploads pause offline without using attempts, resume on online, and the UI wording is right", async () => {
  const t = await read("photo-bucket/transport.js"), app = await read("photo-bucket/app.js");
  assert.match(t, /error\.network \|\| \(typeof navigator/); assert.match(t, /attempts: Math\.max\(0, job\.attempts - 1\)/); assert.match(t, /await transport\.waitOnline\(\)/);
  assert.match(t, /Tap Retry/); assert.doesNotMatch(t.match(/transport\.online \? '[^']*' : 'Retrying local/)?.[0] || "", /Retrying local processing…'$/);
  assert.ok(ONLINE_ATTEMPTS >= 8);
  assert.match(app, /\$\{online \? ONLINE_ATTEMPTS : 3\}/); assert.doesNotMatch(app, /attempt \$\{job\.attempts\}\/3/);
  // waitOnline resolves at once when online
  globalThis.navigator ??= { onLine: true };
  await waitOnline();
});

test("D9: thumbnails retry 503 and 429 with backoff", async () => {
  const a = await read("photo-bucket/adapter-api.js");
  assert.match(a, /response\.status === 503 \|\| response\.status === 429/); assert.match(a, /attempt >= 5/); assert.match(a, /Math\.random\(\) \* Math\.min\(8000/);
});
