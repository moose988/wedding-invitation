import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("My Events keeps search and status controls hidden after role resolution", async () => {
  const [html, script, styles] = await Promise.all([
    read("customer-events.html"),
    read("weddings.js"),
    read("weddings.css"),
  ]);

  assert.match(html, /id="workspaceControls"[^>]*hidden/);
  assert.match(html, /id="filterRow"[^>]*hidden/);
  assert.match(script, /state\.isAdmin = await isPlatformAdmin\(accountApi, state\.services\.db, user\.uid\);\s*state\.roleResolved = true;/);
  assert.match(script, /function isCustomerView\(\)[\s\S]*?document\.body\.dataset\.accountSurface === "customer"/);
  assert.match(script, /function syncEventControls\(\)[\s\S]*?el\.searchInput\.value = "";[\s\S]*?el\.sortSelect\.value = "event";[\s\S]*?state\.filter = "all";/);
  assert.match(script, /if \(customerView\) return true;/);
  assert.match(styles, /\.workspace-controls\[hidden\], \.filter-row\[hidden\]\s*\{\s*display:none !important;\s*\}/);
});

test("role-pending account changes hide controls until the actual role is rechecked", async () => {
  const [script, adminHtml] = await Promise.all([
    read("weddings.js"),
    read("all-events.html"),
  ]);

  assert.match(script, /setEventControlsVisibility\(false\);[\s\S]*?state\.roleResolved = false;[\s\S]*?el\.workspace\.hidden = true;/);
  assert.match(script, /state\.isAdmin = await isPlatformAdmin\(accountApi, state\.services\.db, user\.uid\);\s*state\.roleResolved = true;/);
  assert.match(script, /if \(!state\.isAdmin && !customerSurface\) return location\.replace\("\.\/customer-events\.html"\);/);
  assert.match(script, /if \(state\.isAdmin && customerSurface\) return location\.replace\("\.\/all-events\.html"\);/);
  assert.match(adminHtml, /id="workspaceControls" aria-label="Event controls">/);
  assert.match(adminHtml, /id="filterRow"/);
  assert.match(script, /collection\(state\.services\.db, "users", state\.user\.uid, "weddingAccess"\)/);
});
