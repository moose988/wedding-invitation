import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { adminPost, explainFailure, failedChecks } from "../admin-api.js";
import { bannerHtml, runAdminHealth } from "../admin-health.js";

const read = f => readFile(new URL(`../${f}`, import.meta.url), "utf8");
// Every file that runs an admin, customer or photo bucket action.
const FILES = ["customers.js", "customer-link.js", "admin-workspace.js", "admin-health.js", "admin-api.js", "admin-events.js", "clients.js", "client-notes.js", "weddings.js", "customer-list.js",
  "photo-bucket/app.js", "photo-bucket/adapter-api.js", "photo-bucket/transport.js", "photo-bucket/workspace.js", "photo-bucket/auth.js", "schedule-editor.js"];

// Finds catch blocks and .catch(() => ...) callbacks that hide an error. A body that holds only a comment is
// allowed, because the comment states why ignoring it is safe (storage blocked, best-effort cleanup).
function swallowed(source) {
  const found = [];
  const line = index => source.slice(0, index).split("\n").length;
  for (const m of source.matchAll(/catch\s*(\(\s*\w*\s*\))?\s*\{/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < source.length && depth) { if (source[i] === "{") depth++; else if (source[i] === "}") depth--; i++; }
    const body = source.slice(m.index + m[0].length, i - 1).trim();
    const code = body.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").trim();
    const consoleOnly = code && code.split(/;|\n/).map(x => x.trim()).filter(Boolean).every(x => /^console\.\w+\(/.test(x));
    if ((!code && !/\/\*|\/\//.test(body)) || consoleOnly) found.push(`line ${line(m.index)}: ${body.slice(0, 60) || "(empty)"}`);
  }
  for (const m of source.matchAll(/\.catch\(\s*\(?\w*\)?\s*=>\s*(\{\s*\}|\[\]|null|undefined)\s*\)/g)) found.push(`line ${line(m.index)}: ${m[0]}`);
  return found;
}

test("no action handler swallows an error (empty catch, console-only catch, or .catch(() => []))", async () => {
  const problems = [];
  for (const file of FILES) for (const issue of swallowed(await read(file))) problems.push(`${file} ${issue}`);
  assert.deepEqual(problems, []);
});

test("the scanner itself catches the bad patterns", () => {
  assert.equal(swallowed("try { a(); } catch {}").length, 1);
  assert.equal(swallowed("try { a(); } catch (e) { console.error(e); }").length, 1);
  assert.equal(swallowed("p.catch(() => {})").length, 1);
  assert.equal(swallowed("p.catch(() => [])").length, 1);
  assert.equal(swallowed("try { a(); } catch { /* storage is blocked, default is fine */ }").length, 0);
  assert.equal(swallowed("try { a(); } catch (e) { show(e.message); }").length, 0);
});

test("setup problems are named exactly: unreachable, 404 function missing, 503 not configured", async () => {
  const auth = { currentUser: { getIdToken: async () => "t" } };
  const net = await adminPost(auth, "/api/x", {}, async () => { throw new TypeError("Failed to fetch"); }, { what: "Linking" }).catch(e => e);
  assert.match(net.message, /could not reach the server/); assert.equal(net.code, "NETWORK");
  const missing = await adminPost(auth, "/api/x", {}, async () => ({ ok: false, status: 404, json: async () => { throw new Error("html"); } }), { what: "Linking" }).catch(e => e);
  assert.match(missing.message, /Server setup is incomplete: Linking needs a server function that was not found/); assert.match(missing.message, /Contact an admin/);
  const htmlOk = await adminPost(auth, "/api/x", {}, async () => ({ ok: true, status: 200, json: async () => { throw new Error("html"); } })).catch(e => e);
  assert.match(htmlOk.message, /Server setup is incomplete/, "a page instead of JSON means the function is missing");
  const unconfigured = await adminPost(auth, "/api/x", {}, async () => ({ ok: false, status: 503, json: async () => ({ code: "NOT_CONFIGURED", error: "FIREBASE_SERVICE_ACCOUNT is not set" }) })).catch(e => e);
  assert.match(unconfigured.message, /Server setup is incomplete: FIREBASE_SERVICE_ACCOUNT is not set\. Contact an admin\./);
  assert.match(explainFailure({ status: 500, code: "INTERNAL", what: "Saving" }), /failed on the server \(INTERNAL\)/);
  assert.match(explainFailure({ status: 401 }), /Sign in again/);
});

test("admin health: failed checks (either shape) and a failed check call both produce a banner", async () => {
  assert.deepEqual(failedChecks({ checks: [{ name: "cron", ok: false, message: "CRON_SECRET missing" }, { name: "db", ok: true }] }), [{ name: "cron", message: "CRON_SECRET missing" }]);
  assert.equal(failedChecks({ checks: { a: { ok: true }, b: { ok: false, message: "x" } } }).length, 1);
  assert.equal(failedChecks({ ok: true, checks: [] }).length, 0);
  const store = new Map(); globalThis.sessionStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const auth = { currentUser: { getIdToken: async () => "t" } };
  let calls = 0;
  const down = await runAdminHealth(auth, async () => { calls++; return { ok: false, status: 404, json: async () => { throw new Error("x"); } }; });
  assert.match(down.runError, /Server setup is incomplete/); await runAdminHealth(auth, async () => { calls++; throw new Error("no"); });
  assert.equal(calls, 1, "asked once per session");
  assert.match(bannerHtml({ failures: [{ name: "<b>cron</b>", message: "bad" }], runError: "" }), /&lt;b&gt;cron/);
  assert.match(bannerHtml(down), /data-banner-dismiss/);
});

test("admin pages mount the health banner and every action reports busy, success or a clear error", async () => {
  for (const f of ["admin-workspace.js", "clients.js", "customers.js"]) assert.match(await read(f), /mountAdminHealth\(/, f);
  const w = await read("weddings.js"); assert.match(w, /handleCardActionUnsafe/); assert.match(w, /Duplicating the event…/);
  assert.doesNotMatch(await read("customers.js"), /fetch\("\/api\/customer-management"/, "uses the shared, explained call");
  assert.match(await read("photo-bucket/adapter-api.js"), /Server setup is incomplete: the photo bucket service was not found/);
});

// ---- Button feedback ----
test("every page loads the shared feedback script and style, with reduced motion handled", async () => {
  const { readdir } = await import("node:fs/promises");
  const pages = (await readdir(new URL("../", import.meta.url))).filter(f => f.endsWith(".html"));
  assert.ok(pages.length >= 16);
  for (const page of pages) { const html = await read(page); assert.match(html, /action-feedback\.js/, page); assert.match(html, /skeleton\.css/, page); }
  const css = await read("skeleton.css");
  for (const part of [/button:active:not\(:disabled\)/, /button\.is-busy::before/, /\.action-error/, /prefers-reduced-motion: reduce/]) assert.match(css, part);
});

test("central click dispatchers give busy and result feedback", async () => {
  const expect = { "dashboard.js": /runFromEvent\(event, \(\) => handleAction/, "checkin.js": /runFromEvent\(event, \(\) => checkInGuest/, "weddings.js": /runFromEvent\(event, \(\) => handleCardActionUnsafe/, "photo-bucket/app.js": /runFromEvent\(event, \(\) => work\(event\)/, "script.js": /runFromEvent\(event, async \(\) => downloadCalendarFile/ };
  for (const [file, pattern] of Object.entries(expect)) assert.match(await read(file), pattern, file);
});

// Practical check: an async click handler in an admin file must report its outcome (try/catch, runAction/runFromEvent) or show busy.
test("async click handlers in admin files have a result or busy path", async () => {
  const bad = [];
  for (const file of ["customers.js", "customer-link.js", "admin-workspace.js", "clients.js", "client-notes.js", "admin-health.js"]) {
    const s = await read(file);
    for (const m of s.matchAll(/(?:addEventListener\("click",|\.onclick =)\s*async\s*(?:\(?\w*\)?)\s*=>\s*\{/g)) {
      let i = m.index + m[0].length, depth = 1;
      while (i < s.length && depth) { if (s[i] === "{") depth++; else if (s[i] === "}") depth--; i++; }
      const body = s.slice(m.index + m[0].length, i - 1);
      if (!/try\s*\{|runAction|runFromEvent|\.disabled\s*=|textContent\s*=/.test(body)) bad.push(`${file}:${s.slice(0, m.index).split("\n").length}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("runAction shows busy, then success or a clear error, and never throws", async () => {
  const { runAction } = await import("../action-feedback.js");
  const classes = new Set(), attrs = {}; const toasts = [];
  const button = { dataset: {}, textContent: "Save", disabled: false, isConnected: true, parentElement: null, classList: { add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), contains: c => classes.has(c) }, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }, insertAdjacentHTML() {}, nextElementSibling: { textContent: "" } };
  let seenBusy;
  const ok = await runAction(button, async () => { seenBusy = [button.disabled, classes.has("is-busy"), button.textContent]; return 5; }, { busyLabel: "Saving…", success: "Saved.", toast: (m, k) => toasts.push([m, k]) });
  assert.deepEqual(seenBusy, [true, true, "Saving…"]); assert.equal(ok.ok, true); assert.equal(button.disabled, false); assert.equal(button.textContent, "Save"); assert.deepEqual(toasts[0], ["Saved.", "success"]);
  const bad = await runAction(button, async () => { throw new Error("Server setup is incomplete: X. Contact an admin."); }, { toast: (m, k) => toasts.push([m, k]) });
  assert.equal(bad.ok, false); assert.equal(toasts.at(-1)[1], "error"); assert.match(toasts.at(-1)[0], /Server setup is incomplete/); assert.equal(button.disabled, false);
  const net = await runAction(button, async () => { throw new TypeError("Failed to fetch"); }, { what: "Saving", toast: (m, k) => toasts.push([m, k]) });
  assert.match(toasts.at(-1)[0], /Saving could not reach the server/);
});
