import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { bucketItem, eventItem, itemCardHtml, noticesHtml, sortCustomerItems } from "../customer-list.js";

const now = new Date(2026, 10, 3, 15).getTime();
const ev = (id, name, y, m, d) => eventItem({ id }, { name, dateText: "x", ms: new Date(y, m - 1, d, 20).getTime() });

test("events and buckets share one list, nearest upcoming first, then past, then undated", () => {
  const items = sortCustomerItems([
    ev("past", "Past", 2026, 10, 1), bucketItem({ id: "b2", name: "Later bucket", date: "2027-02-01" }, "1 Feb"),
    ev("soon", "Soon", 2026, 11, 20), bucketItem({ id: "b1", name: "Today bucket", date: "2026-11-03" }, "today"),
    bucketItem({ id: "nodate", name: "No date" }, ""), ev("older", "Older", 2026, 3, 1),
  ], now);
  assert.deepEqual(items.map(i => i.id), ["b1", "soon", "b2", "past", "older", "nodate"]);
  assert.deepEqual(sortCustomerItems([ev("only", "One", 2027, 1, 1)], now).map(i => i.id), ["only"], "a single item still lists");
  assert.deepEqual(sortCustomerItems([], now), []);
});

test("cards name the type, show the date, have one main action and escape text", () => {
  const e = itemCardHtml(eventItem({ id: "e<1>" }, { name: "<b>Wedding</b>", dateText: "20 May", ms: 1 }));
  assert.doesNotMatch(e, /<b>/); assert.match(e, />Invitation</); assert.match(e, /20 May/); assert.match(e, /data-action="open" data-id="e&lt;1&gt;"/);
  const b = itemCardHtml(bucketItem({ id: "b-1", name: "Photos", date: "2027-01-01" }, "1 Jan 2027"));
  assert.match(b, />Photo Bucket</); assert.match(b, /href="\.\/photo-bucket-manage\.html\?bucket=b-1"/);
  for (const html of [e, b]) assert.equal((html.match(/customer-item__action/g) || []).length, 1);
  assert.match(noticesHtml([{ text: "Failed", retry: "buckets" }]), /role="alert"[\s\S]*data-retry="buckets"/);
});

test("customer page uses the shared list, drops the promo, and failures stay separate", async () => {
  const [w, html, css, a, adapter] = await Promise.all(["weddings.js", "customer-events.html", "customer-events-design.css", "admin-workspace.js", "photo-bucket/adapter-api.js"].map(f => readFile(new URL(`../${f}`, import.meta.url), "utf8")));
  assert.match(w, /if \(customerView\) \{ renderCustomerList\(\); return; \}/);
  assert.match(w, /accountSurface === "customer"\) void loadCustomerBuckets\(\); else void renderLocalBuckets/);
  assert.match(w, /state\.bucketsState = "error"/); assert.match(w, /retry: "events"/);
  assert.doesNotMatch(html, /Discover Photo Bucket/);
  assert.match(css, /min-height: 48px/); assert.match(css, /max-width: 480px/);
  assert.match(adapter, /'\/admin\/backups'/); assert.match(a, /platformBackups\(\)/);
});
