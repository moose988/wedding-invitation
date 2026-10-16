import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { paginateRows } from "../workspace-pagination.js";

test("All Events hides its full-screen loading placeholder after workspace initialization", async () => {
  const [html, script, styles] = await Promise.all([
    readFile(new URL("../all-events.html", import.meta.url), "utf8"),
    readFile(new URL("../weddings.js", import.meta.url), "utf8"),
    readFile(new URL("../weddings.css", import.meta.url), "utf8"),
  ]);

  assert.match(html, /id="loadingState"[^>]*class="workspace-loading"|class="workspace-loading"[^>]*id="loadingState"/);
  assert.match(script, /el\.loadingState\.hidden = true/);
  assert.match(styles, /\.workspace-loading\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
  assert.match(html, /<title>All Events · qdsystems<\/title>/);
  assert.match(html, /<h1>All Events<\/h1>/);
  assert.doesNotMatch(html, /My Events/);
  assert.match(html, /weddings\.css\?v=20261016-account-controls-hide/);
});

test("All Events displays six events per page and clamps navigation after filtering", () => {
  const rows = Array.from({ length: 13 }, (_, index) => `event-${index + 1}`);
  const first = paginateRows(rows, 1, 6);
  const second = paginateRows(rows, 2, 6);
  const third = paginateRows(rows, 3, 6);

  assert.deepEqual(first.items, rows.slice(0, 6));
  assert.deepEqual(second.items, rows.slice(6, 12));
  assert.deepEqual(third.items, rows.slice(12));
  assert.equal(first.pageCount, 3);
  assert.equal(paginateRows(rows.slice(0, 2), 3, 6).page, 1);
  assert.equal(paginateRows([], 1, 6).pageCount, 1);
});
