import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const files = execFileSync("git", ["ls-files", "*.js", "*.html"], { cwd: root, encoding: "utf8" }).split("\n")
  .filter((f) => f && !/^(backend|tests|api|scripts|vendor)\//.test(f));
const read = (f) => readFileSync(path.join(root, f), "utf8");

test("every browser module is loaded under exactly one URL, so it downloads and runs once", () => {
  const seen = new Map();
  for (const file of files) {
    const text = read(file);
    const specs = [...text.matchAll(/(?:from |import\()\s*['"](\.{1,2}\/[^'"]+\.js(?:\?[^'"]*)?)['"]/g), ...text.matchAll(/<script[^>]+type="module"[^>]+src="(\.{1,2}\/[^"]+\.js(?:\?[^"]*)?)"/g)].map((m) => m[1]);
    for (const spec of specs) {
      const target = path.normalize(path.join(path.dirname(file), spec.split("?")[0]));
      const query = spec.split("?")[1] || "";
      if (!seen.has(target)) seen.set(target, new Set());
      seen.get(target).add(query);
    }
  }
  const dupes = [...seen].filter(([, q]) => q.size > 1).map(([t, q]) => `${t}: ${[...q].join(" | ")}`);
  assert.deepEqual(dupes, []);
});

test("customers do not download the admin-only music and export code up front", () => {
  for (const file of ["weddings.js", "dashboard.js"]) {
    const text = read(file);
    assert.doesNotMatch(text, /^import [^;]*from "\.\/(music-settings|music-api|export)\.js";/m, `${file} imports admin-only code statically`);
  }
});

test("the main pages preload their module graph in parallel", () => {
  for (const page of ["dashboard.html", "customer-events.html", "all-events.html"]) {
    const html = read(page);
    const links = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(links.length >= 10, `${page} preloads its modules`);
    for (const href of links) assert.ok(read(path.normalize(href.split("?")[0])).length > 0, `${page}: ${href} exists`);
  }
});
