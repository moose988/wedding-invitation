import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Layla details artwork begins as soon as the first post-cover section enters view", async () => {
  const [script, styles] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../invitations/wedding-designs/layla-zaid/styles.css", import.meta.url), "utf8"),
  ]);
  const setup = script.match(/function setupLaylaDetailsBackdrop\(\) \{[\s\S]*?\n\}/)?.[0] || "";

  assert.match(setup, /getElementById\("countdownSection"\)/);
  assert.doesNotMatch(setup, /getElementById\("heroSection"\)/);
  assert.match(setup, /if \(!entry\.isIntersecting\) return;[\s\S]*?revealBackdrop\(\);[\s\S]*?observer\.disconnect\(\)/);
  assert.match(styles, /\.layla-details-backdrop\s*\{[\s\S]*?position:\s*fixed[\s\S]*?inset:\s*0/);
  assert.match(styles, /\.invitation-open\.layla-details-visible \.layla-details-backdrop\s*\{\s*opacity:\s*1/);
});

test("Layla date, venue, and location cards use the same fine outline without a stray side divider", async () => {
  const styles = await readFile(new URL("../invitations/wedding-designs/layla-zaid/styles.css", import.meta.url), "utf8");

  assert.match(styles, /body\.layla-zaid-invitation \.detail-card\s*\{[^}]*border:\s*1px solid rgba\(177, 145, 99, 0\.5\)[^}]*border-radius:\s*12px/);
  assert.match(styles, /body\.layla-zaid-invitation\.invitation-open \.site-content \.detail-card\s*\{[\s\S]*?border:\s*1px solid rgba\(177, 145, 99, 0\.5\)[\s\S]*?border-radius:\s*12px/);
  assert.doesNotMatch(styles, /\.detail-card\s*\+\s*\.detail-card\s*\{[^}]*border-inline-start/);
});
