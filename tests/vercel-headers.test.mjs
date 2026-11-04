import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const firebase = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8")).hosting.headers;
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
const norm = (list) => Object.fromEntries(list.map(({ key, value }) => [key.toLowerCase(), value]));
const firebaseGlobal = norm(firebase.find((e) => e.source === "**").headers);

test("Vercel sends the same security headers as Firebase Hosting on every path", () => {
  const rule = vercel.headers.find((e) => e.source === "/(.*)");
  assert.deepEqual(norm(rule.headers), firebaseGlobal);
});

test("application pages are never cached, with or without .html", () => {
  for (const page of ["/", "/dashboard", "/dashboard-login", "/customer-login", "/photo-bucket-manage", "/photo-bucket", "/side", "/send", "/checkin", "/all-events", "/customer-events", "/gender-reveal", "/photo-bucket-poster"]) {
    const rule = vercel.headers.find((e) => e.source === page);
    assert.ok(rule, `${page} needs a no-store rule`);
    assert.match(norm(rule.headers)["cache-control"] || "", /no-store/i);
  }
  assert.ok(vercel.headers.some((e) => e.source === "/(.*)\\.html"));
});

test("every clean page address has both its redirect and its rewrite", () => {
  const pages = vercel.rewrites.map((r) => r.source);
  assert.ok(pages.length >= 12);
  for (const source of pages) assert.ok(vercel.redirects.some((r) => r.source === `${source}.html` && r.destination === source), source);
});
