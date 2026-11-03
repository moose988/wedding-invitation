import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as money from "../admin-money.js";
import * as adminApi from "../admin-api.js";
import { quoteHtml } from "../quote-print.js";

const read = file => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("AED amounts are parsed and stored as integer fils, never floats", () => {
  assert.equal(money.parseAedToFils("1,250.5"), 125050);
  assert.equal(money.parseAedToFils("0.07"), 7);
  assert.equal(money.parseAedToFils("19.99"), 1999);
  for (const bad of ["1.234", "-5", "1e3", "", "abc", "12.", "1000000000"]) assert.equal(money.parseAedToFils(bad), null, bad);
  assert.equal(money.formatAed(125050), "AED 1,250.50");
  assert.equal(money.formatAed(5), "AED 0.05");
  assert.equal(money.filsToInput(1999), "19.99");
});

test("quote totals are integer fils: discount, optional 5% VAT (off by default), rounding", () => {
  const lines = [{ quantity: 3, unitPriceFils: 3333 }, { quantity: 1, unitPriceFils: 1 }];
  const plain = money.computeTotals(lines);
  assert.deepEqual(plain, { subtotalFils: 10000, discountFils: 0, vatFils: 0, totalFils: 10000 });
  const withVat = money.computeTotals(lines, { discountFils: 1000, vat: true });
  assert.deepEqual(withVat, { subtotalFils: 10000, discountFils: 1000, vatFils: 450, totalFils: 9450 });
  assert.equal(money.computeTotals(lines, { discountFils: 99999999 }).totalFils, 0, "discount is capped at the subtotal");
  assert.equal(money.vatOn(10), 1, "0.5 fils rounds half up");
  for (const v of Object.values(withVat)) assert.ok(Number.isInteger(v));
  assert.equal(money.VAT_PERCENT, 5);
});

test("validation checks every line up to 50, not only the first 10", () => {
  const good = { description: "Item", quantity: 1, unitPriceFils: 100 };
  const lines = Array.from({ length: 50 }, () => ({ ...good }));
  assert.equal(money.validateLines(lines).ok, true);
  lines[37] = { description: "", quantity: 0, unitPriceFils: 1.5 };
  const result = money.validateLines(lines);
  assert.equal(result.ok, false);
  assert.deepEqual([...new Set(result.errors.map(e => e.index))], [37]);
  assert.equal(result.errors.length, 3);
  assert.equal(money.validateLines([...Array(51)].map(() => ({ ...good }))).ok, false);
  assert.equal(money.validateLines([]).ok, false);
  assert.deepEqual(Object.keys(money.buildLineItems([good])[0]).sort(), ["description", "quantity", "totalFils", "unitPriceFils"], "exact shape the rules accept");
});

test("default terms carry the 48-hour photo bucket term and owner placeholders, no invented claims", () => {
  assert.ok(money.DEFAULT_TERMS.startsWith("Photo buckets are deleted 48 hours after the event. Please download your photos before then."));
  assert.equal(money.PHOTO_BUCKET_TERM, "Photo buckets are deleted 48 hours after the event. Please download your photos before then.");
  for (const word of ["Payment", "Cancellation", "Liability"]) assert.match(money.DEFAULT_TERMS, new RegExp(`${word}: \\[OWNER TO COMPLETE`));
  assert.doesNotMatch(money.DEFAULT_TERMS, /licen[cs]e|registered|trade no|VAT (number|reg)|TRN/i);
  assert.equal(money.COMPANY.phone, "+971504611123");
});

test("printable quotation is branded, in AED and escapes user text", () => {
  const html = quoteHtml({ number: "QD-1", client: { name: "<img src=x onerror=alert(1)>" }, lineItems: [{ description: "<b>Bucket</b>", quantity: 2, unitPriceFils: 5000, totalFils: 10000 }], totals: { subtotalFils: 10000, discountFils: 0, vatFils: 0, totalFils: 10000 }, terms: "a <script>x</script>\nb", validUntil: new Date(2027, 0, 5), date: new Date(2026, 10, 3) });
  assert.doesNotMatch(html, /<img|<b>|<script/);
  assert.match(html, /QD Systems/); assert.match(html, /\+971504611123/); assert.match(html, /AED 100\.00/);
});

test("admin helpers: 48 hour overdue rule, countdown, per-target results, encoding", async () => {
  const day = "2026-11-01"; const end = Date.UTC(2026, 10, 2);
  assert.equal(adminApi.bucketOverdue({ date: day }, end + 48 * 3600e3 - 1), false);
  assert.equal(adminApi.bucketOverdue({ date: day }, end + 48 * 3600e3 + 1), true);
  assert.equal(adminApi.bucketOverdue({ date: day, demo: true }, end + 1e12), false);
  assert.equal(adminApi.bucketOverdue({ date: day, overdue: false }, end + 1e12), false, "server flag wins");
  assert.equal(adminApi.formatCountdown(1000 + 3661000, 1000), "1h 01m 01s left");
  assert.equal(adminApi.formatCountdown(1, 2), "Expired");
  assert.equal(adminApi.describeTargetResult({ ok: true, status: "preserved" }), "Already has access");
  assert.equal(adminApi.describeTargetResult({ ok: false, code: "NOT_ATTEMPTED" }), "Ran out of time, try again");
  assert.equal(adminApi.esc(`<a href="x">'\``), "&lt;a href=&quot;x&quot;&gt;&#39;&#096;");
  const seen = [];
  const auth = { currentUser: { getIdToken: async () => "tok" } };
  const ok = await adminApi.adminPost(auth, "/api/x", { a: 1 }, async (url, init) => { seen.push([url, init]); return { ok: true, json: async () => ({ fine: true }) }; });
  assert.deepEqual(ok, { fine: true }); assert.equal(seen[0][1].headers.Authorization, "Bearer tok");
  await assert.rejects(adminApi.adminPost(auth, "/api/x", {}, async () => ({ ok: false, status: 403, json: async () => ({ error: "No", code: "ADMIN_ONLY" }) })), e => e.code === "ADMIN_ONLY" && e.status === 403 && /not recognised as an admin/.test(e.message));
});

test("demo duration choices and request", async () => {
  assert.deepEqual(adminApi.DEMO_DURATIONS.map(d => d.hours), [6, 12, 24, 48, 72, 168]);
  assert.equal(adminApi.DEFAULT_DEMO_HOURS, 24);
  const source = await read("admin-workspace.js");
  assert.match(source, /name="demoHours" required/);
  assert.match(source, /\{ type, name, expiresInHours \}/);
  assert.match(source, /ensureGenderRevealPublished\(ctx\.accountApi/);
  for (const file of ["admin-api.js", "admin-workspace.js", "weddings.js"]) assert.doesNotMatch(await read(file), /within 24 hours|always .{0,20}24 hours/i, file);
  assert.match(adminApi.DEMO_NOTICE, /1 GB/);
});

test("admin events list, delete and copy fixes in weddings.js", async () => {
  const w = await read("weddings.js");
  assert.match(w, /!state\.isAdmin\) \{\s*throw new Error\("Only the event owner or a platform admin/);
  assert.match(w, /loadAllAdminEvents\(/);
  assert.match(w, /"customerAudit", "genderRevealSessionKeys"/);
  const dup = w.slice(w.indexOf("async function duplicate"), w.indexOf("function openDelete"));
  for (const field of ["isDemo", "demoExpiresAt", "demoAccountUid"]) assert.match(dup, new RegExp(`\\b${field}\\b`));
  assert.match(w, /That event no longer exists/);
});

test("clients page: admin guard, route, no-store, every client write uses integer fils", async () => {
  const vercel = JSON.parse(await read("vercel.json"));
  assert.ok(vercel.redirects.some(r => r.source === "/clients.html" && r.destination === "/clients"));
  assert.ok(vercel.rewrites.some(r => r.source === "/clients" && r.destination === "/clients.html"));
  assert.ok(vercel.headers.some(h => h.source === "/clients" && h.headers.some(x => x.key === "Cache-Control" && /no-store/.test(x.value))));
  const js = await read("clients.js");
  assert.match(js, /isPlatformAdmin\(api, state\.services\.db, user\.uid\)/);
  assert.match(js, /customer-events\.html/);
  assert.doesNotMatch(js, /parseFloat|toFixed|Number\([^)]*price/i);
  assert.match(js, /MAX_QUOTE_LINES/);
});

test("photo bucket adapter uses /deleted with deletedId and promises no recovery window", async () => {
  const a = await read("photo-bucket/adapter-api.js");
  assert.match(a, /\/b\/\$\{validId\(bucketId\)\}\/deleted`/);
  assert.match(a, /\/deleted\/\$\{encodeURIComponent\(deletedId\)\}\/restore/);
  assert.doesNotMatch(a, /\/trash`|trashId|recoverableUntil/);
  for (const f of ["photo-bucket/app.js", "admin-workspace.js", "photo-bucket/adapter-api.js"]) assert.doesNotMatch(await read(f), /30[- ]day|recoverableUntil/i, f);
  const app = await read("photo-bucket/app.js");
  assert.match(app, /permanently deletes your photo[^`]*It cannot be undone/);
  assert.match(await read("admin-workspace.js"), /quality 80 backup copy/);
});

test("customer audit is wired into customer write paths only", async () => {
  const d = await read("dashboard.js");
  assert.ok((d.match(/auditCustomerAction\(/g) || []).length >= 12);
  assert.match(d, /recordCustomerAudit\(\{ api: accountApi/);
  for (const f of ["customer-projections.js", "guest-edit.js", "seating-transactions.js", "dashboard-persistence.js", "script.js", "gender-reveal-submission.js"]) assert.doesNotMatch(await read(f), /recordCustomerAudit|auditCustomerAction/, f);
});
