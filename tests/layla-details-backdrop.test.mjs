import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Layla details artwork is ready on open and stays stable across mobile viewport changes", async () => {
  const [script, styles, sharedStyles] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../invitations/wedding-designs/layla-zaid/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);
  const setup = script.match(/function setupLaylaDetailsBackdrop\(\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(setup, /document\.body\.classList\.add\("layla-details-visible"\)/);
  assert.doesNotMatch(setup, /IntersectionObserver|countdownSection/);
  assert.match(styles + sharedStyles, /body\.layla-zaid-invitation \.layla-details-backdrop\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/);
  assert.match(styles, /body\.layla-zaid-invitation \.layla-details-backdrop\s*\{[^}]*height:\s*100lvh[^}]*transition:\s*none/);
  assert.match(styles, /body\.layla-zaid-invitation #heroSection \.hero-paper\s*\{[^}]*height:\s*100lvh[^}]*background-size:\s*cover/);
  assert.match(styles, /body\.layla-zaid-invitation \.envelope-intro\s*\{[^}]*height:\s*100lvh/);
  assert.match(styles, /body\.layla-zaid-invitation:has\(> aside\[role="status"\]\) \.layla-language-toggle \{ top: max\(52px/);
  assert.match(styles, /body\.layla-zaid-invitation \.closing-section:has\(\.closing-card__arabic:empty\):has\(\.closing-card__english:empty\) \{ display: none; \}/);
});

test("Layla details use labeled accessible tabs and the seating viewport is shorter without geometry scaling", async () => {
  const [script, html, styles, sharedStyles] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../invitations/wedding-designs/layla-zaid/index.html", import.meta.url), "utf8"),
    readFile(new URL("../invitations/wedding-designs/layla-zaid/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(script, /role="tablist"/);
  assert.match(script, /role="tab"/);
  assert.match(script, /role="tabpanel"/);
  assert.match(script, /ArrowRight|ArrowLeft/);
  assert.match(script, /Home|End/);
  assert.match(html, /detail-switcher/);
  assert.match(styles, /body\.layla-zaid-invitation \.seat-plan-viewport\s*\{\s*height:\s*360px;\s*min-height:\s*360px/);
  assert.doesNotMatch(styles + sharedStyles, /seat-plan-viewport[^{]*\{[^}]*transform:\s*scale\(/s);
});

test("Layla date, venue, and location cards use the same fine outline without a stray side divider", async () => {
  const styles = await readFile(new URL("../invitations/wedding-designs/layla-zaid/styles.css", import.meta.url), "utf8");

  assert.match(styles, /body\.layla-zaid-invitation \.detail-card\s*\{[^}]*border:\s*1px solid rgba\(177, 145, 99, 0\.5\)[^}]*border-radius:\s*12px/);
  assert.match(styles, /body\.layla-zaid-invitation\.invitation-open \.site-content \.detail-card\s*\{[\s\S]*?border:\s*1px solid rgba\(177, 145, 99, 0\.5\)[\s\S]*?border-radius:\s*12px/);
  assert.doesNotMatch(styles, /\.detail-card\s*\+\s*\.detail-card\s*\{[^}]*border-inline-start/);
});
