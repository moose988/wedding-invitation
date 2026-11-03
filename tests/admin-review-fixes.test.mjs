import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLru, createThumbQueue } from "../photo-bucket/thumb-queue.js";
import { splitZipParts, zipPartName } from "../photo-bucket/zip.js";
import { jitteredWait } from "../photo-bucket/transport.js";
import { loadAllAdminEvents, mergeById } from "../admin-events.js";

const read = f => readFile(new URL(`../${f}`, import.meta.url), "utf8");

test("thumbnail queue runs at most 4 at a time and skips cancelled items", async () => {
  let active = 0, peak = 0; const started = []; const gates = [];
  const queue = createThumbQueue({ concurrency: 4, load: (key) => { active++; peak = Math.max(peak, active); started.push(key); return new Promise(res => gates.push(() => { active--; res(key); })); } });
  const done = [];
  for (let i = 0; i < 10; i++) queue.request(`k${i}`, { id: i }, v => done.push(v));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(queue.stats().running, 4);
  assert.equal(queue.cancel("k9"), true, "a waiting item can be cancelled");
  assert.equal(queue.cancel("k0"), false, "a running item cannot");
  queue.request("k1", {}, () => {}); assert.equal(queue.stats().waiting, 5, "asking again for a running or queued key adds nothing");
  while (gates.length) { gates.shift()(); await new Promise(r => setTimeout(r, 0)); }
  assert.ok(peak <= 4); assert.ok(!started.includes("k9")); assert.equal(done.length, 9);
});

test("one failing thumbnail does not stop the others, and the cache is bounded", async () => {
  const ok = [], bad = [];
  const queue = createThumbQueue({ concurrency: 2, load: key => key === "b" ? Promise.reject(new Error("gone")) : Promise.resolve(key) });
  for (const k of ["a", "b", "c"]) queue.request(k, {}, v => ok.push(v), e => bad.push(k));
  await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(ok.sort(), ["a", "c"]); assert.deepEqual(bad, ["b"]);
  const lru = createLru(3); for (const k of "abcd") lru.set(k, k);
  assert.equal(lru.size, 3); assert.equal(lru.has("a"), false);
});

test("large galleries split into numbered ZIP parts within 500 photos and 128 MB", () => {
  const photos = Array.from({ length: 1200 }, (_, i) => ({ id: `p${i}`, size: 1024 * 1024 }));
  const parts = splitZipParts(photos);
  assert.ok(parts.every(p => p.length <= 500 && p.reduce((n, x) => n + x.size, 0) <= 128 * 1024 * 1024));
  assert.equal(parts.flat().length, 1200);
  const heavy = splitZipParts(Array.from({ length: 20 }, (_, i) => ({ id: `h${i}`, size: 20 * 1024 * 1024 })));
  assert.ok(heavy.length >= 4);
  assert.equal(zipPartName(1, 5), "photo-bucket-photos-part-2-of-5.zip"); assert.equal(zipPartName(0, 1), "photo-bucket-photos.zip");
});

test("retry waits use full jitter and honour retryAfter", async () => {
  const t0 = Date.now(); await jitteredWait(1, { retryAfter: 0 }, { backoff: 10, random: () => 0 }); assert.ok(Date.now() - t0 < 50);
  const t1 = Date.now(); await jitteredWait(3, { retryAfter: 0.05 }, { random: () => 0 }); assert.ok(Date.now() - t1 >= 40, "retryAfter wins over jitter");
  const src = await read("photo-bucket/transport.js"); assert.match(src, /maxAttempts: ONLINE_ATTEMPTS/);
});

test("the admin event loader pages until empty, keeps ids stable and says when it stops early", async () => {
  const all = Array.from({ length: 250 }, (_, i) => ({ id: `e${String(i).padStart(3, "0")}`, data: () => ({ n: i }) }));
  const api = { collection: () => "c", limit: n => ({ n }), startAfter: d => ({ after: d }), query: (...p) => p, getDocs: async parts => { const after = parts.find(p => p.after)?.after; const lim = parts.find(p => p.n).n; const start = after ? all.findIndex(d => d.id === after.id) + 1 : 0; return { docs: all.slice(start, start + lim) }; } };
  const full = await loadAllAdminEvents(api, "db");
  assert.equal(full.rows.length, 250); assert.equal(full.truncated, false); assert.equal(full.rows[0].id, "e000");
  const cut = await loadAllAdminEvents(api, "db", { cap: 100 }); assert.equal(cut.truncated, true);
  assert.deepEqual(mergeById([{ id: "a", stats: 5 }], [{ id: "a" }, { id: "b" }], ["stats"]), [{ id: "a", stats: 5 }, { id: "b" }]);
});

test("pages show errors instead of empty lists and use the shared loader", async () => {
  const [w, c, l, cu, a, d] = await Promise.all(["weddings.js", "clients.js", "customer-link.js", "customers.js", "admin-workspace.js", "dashboard.js"].map(read));
  for (const src of [w, c, l, cu]) assert.match(src, /loadAllAdminEvents|loadAdminEventsShared/);
  assert.match(c, /event list could not load/); assert.match(a, /could not be listed/);
  assert.doesNotMatch(a, /\.catch\(\(\) => \[\]\)/);
  assert.match(w, /getCountFromServer/); assert.doesNotMatch(w, /guests\.docs\.map\(\(row\) => row\.data\(\)\)/);
  assert.match(cu, /Open to see assigned events/); assert.doesNotMatch(cu, /data-action="assign"/);
  assert.match(d, /redirectingToEvents/);
  assert.match(await read("admin-api.js"), /access ends|Access ends|access ends/i);
});

test("bucket cards show backups, a re-drive action, and an overdue filter with a count", async () => {
  const a = await read("admin-workspace.js");
  for (const part of [/Backups: /, /data-bucket-action="redrive"/, /redriveBackups/, /Overdue only \(/, /data-show-overdue/, /tab-badge/, /length: 4/]) assert.match(a, part);
});

test("online galleries page, load thumbnails lazily and leave no demo text behind", async () => {
  const [app, adapter, html] = await Promise.all(["photo-bucket/app.js", "photo-bucket/adapter-api.js", "all-events.html"].map(read));
  assert.match(app, /Load more photos/); assert.match(app, /IntersectionObserver/); assert.match(app, /concurrency: 4/); assert.match(app, /splitZipParts/);
  assert.doesNotMatch(adapter, /withThumbnails|new Map\(\)/);
  assert.match(adapter, /deleted: bucketId/); assert.doesNotMatch(adapter, /trash/);
  assert.doesNotMatch(html, /Local demo · Photos/);
  assert.match(app, /online \? 'Share the guest link to start collecting photos\.'/);
});

test("admin tools: retry covers pending backups, server fix hints are shown, failed health is not cached", async () => {
  const ws = await readFile(new URL("../admin-workspace.js", import.meta.url), "utf8");
  assert.match(ws, /\?\.failed \|\| 0\) \+ \(buckets\.backups\.get\(b\.id\)\?\.pending \|\| 0\) > 0/);
  const api = await import("../admin-api.js");
  const failures = api.failedChecks({ ok: false, checks: [{ id: "cron_secret", status: "fail", detail: "too short", fix: "Set CRON_SECRET to 32+ characters." }] });
  assert.match(failures[0].message, /How to fix: Set CRON_SECRET/);
  const fake = async () => new Response(JSON.stringify({ error: "Not configured.", code: "NOT_CONFIGURED", fix: "Set PHOTO_BUCKET_API_URL." }), { status: 503 });
  await assert.rejects(api.adminPost({ currentUser: { getIdToken: async () => "t" } }, "/api/x", {}, fake, { what: "Linking" }), (e) => /How to fix: Set PHOTO_BUCKET_API_URL/.test(e.message));
  const health = await readFile(new URL("../admin-health.js", import.meta.url), "utf8");
  assert.match(health, /if \(!result\.runError && !result\.failures\.length\) write\(result\);/);
});
