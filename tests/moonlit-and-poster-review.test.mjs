import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("Moonlit keeps the opening picture first and its small links tappable", async () => {
  const html = await read("invitations/wedding-designs/moonlit-conservatory/index.html");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, "no inline scripts");
  assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline event handlers");
  assert.match(html, /hero-drawing\.webp"[^>]*fetchpriority="low"/, "the hero drawing does not compete with the opening picture");
  assert.match(html, /<video[^>]*preload="none"[^>]*poster=/, "the opening film only loads when played");
  const css = await read("invitations/wedding-designs/moonlit-conservatory/styles.css");
  assert.match(css, /\.moon-hero-top a, \.qd-footer a \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
});

test("the poster PDF confirms success and reports failure", async () => {
  const app = await read("photo-bucket/app.js");
  assert.match(app, /Preparing PDF…[\s\S]{0,300}PDF downloaded: photo-bucket-card\.pdf[\s\S]{0,200}could not be prepared/);
  const pdf = await read("photo-bucket/poster-pdf.js");
  assert.match(pdf, /loadScript\('\.\/vendor\/html2canvas\.min\.js'/); assert.match(pdf, /format: 'a5'/);
  assert.doesNotMatch(pdf, /https?:\/\//, "libraries load from this site only");
});

test("vendored PDF libraries are listed with their exact versions and licences", async () => {
  const notes = await read("vendor/THIRD-PARTY-NOTICES.md");
  assert.match(notes, /html2canvas 1\.4\.1, MIT/); assert.match(notes, /jsPDF 4\.2\.1, MIT/);
  for (const file of ["html2canvas-LICENSE.txt", "jspdf-LICENSE.txt"]) assert.ok((await read(`vendor/${file}`)).length > 100, file);
});
