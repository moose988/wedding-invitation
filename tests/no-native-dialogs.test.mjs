import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const files = execFileSync("git", ["ls-files", "*.js", "*.html", "*.mjs"], { cwd: root, encoding: "utf8" }).split("\n")
  .filter((f) => f && !/^(vendor|tests|backend|api|scripts|functions|server)\//.test(f));

test("no page uses the browser's native confirm, alert or prompt (they are unstyled and block the page)", () => {
  const hits = [];
  for (const file of files) {
    readFileSync(path.join(root, file), "utf8").split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (/(^|[^\w.])(window\.)?(confirm|alert|prompt)\s*\(/.test(code) && !/confirmAction|showActionMessage/.test(code)) hits.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], "use confirmAction or showActionMessage from action-feedback.js");
});

test("phone tap targets: the stylesheet minimums that the browser audit verified stay at 44 px", () => {
  const read = (f) => readFileSync(path.join(root, f), "utf8");
  assert.match(read("weddings.css"), /#weddingGrid \.card-actions button \{ min-height: 44px; \}/);
  assert.match(read("customers.css"), /\.icon-close \{[^}]*min-height: 44px; min-width: 44px;/);
  assert.match(read("dashboard.css"), /@media \(max-width: 360px\) \{[\s\S]{0,200}\.guest-card__actions \{ grid-template-columns: 44px; \}/);
  assert.match(read("dashboard.css"), /body\.dashboard-body \.guest-quick-button, body\.dashboard-body \.da3wa-button\[data-action="mobile-browse-table"\] \{ min-height: 44px; \}/);
  assert.match(read("customers.css"), /@media \(max-width: 700px\) \{[\s\S]{0,400}body input:not\(\[type=checkbox\]\):not\(\[type=radio\]\):not\(\[type=hidden\]\), body select \{ min-height: 44px; \}/, "phone inputs and selects on admin pages");
});
