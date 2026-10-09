import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const root = new URL("../invitations/wedding-designs/layla-zaid/", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const css = await readFile(new URL("styles.css", root), "utf8");
const script = await readFile(new URL("../../../script.js", root), "utf8");
const assetDir = new URL("assets/", root);

test("Layla landing uses one envelope poster, an envelope-only inline video, and event-owned paper art", () => {
  assert.match(html, /Ivory Wedding Envelope with LZ Seal\.png/);
  assert.match(html, /src="\.\/invitations\/wedding-designs\/layla-zaid\/assets\/enevlope opening\.mp4"/);
  assert.match(html, /playsinline muted preload="auto"/);
  assert.match(html, /id="skipOpening"/);
  assert.doesNotMatch(html, /envelope-layer--seal|envelope-layer--card|heroBackdrop/);
  assert.match(css, /url\("\.\/assets\/Sculpted Ivory Paper Wedding Invitation\.png"\)/);
  assert.match(script, /venueMapEmbedUrl: wedding\.venueMapEmbedUrl \|\| ""/);
  assert.match(html, /Luxury Pearl Oyster Shell Ornament\.png/);
  assert.match(html, /Watercolor Ivory Courtyard Wedding Venue\.png/);
  assert.match(html, /href="https:\/\/qdsystems\.ae"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("the supplied design assets remain present with their source transparency and video", async () => {
  const images = [
    ["Pearlescent Champagne LZ Wax Seal.png", 1254, 1254, 6],
    ["Watercolor Ivory Courtyard Wedding Venue.png", 1536, 1024, 6],
    ["Ivory Wedding Envelope with LZ Seal.png", 941, 1672, 2],
    ["Sculpted Ivory Paper Wedding Invitation.png", 941, 1672, 2],
    ["Luxury Pearl Oyster Shell Ornament.png", 1254, 1254, 6],
  ];
  for (const [filename, width, height, colorType] of images) {
    const bytes = await readFile(new URL(filename, assetDir));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), width, filename);
    assert.equal(bytes.readUInt32BE(20), height, filename);
    assert.equal(bytes[25], colorType, filename);
    assert.ok((await stat(new URL(filename, assetDir))).size > 100_000);
  }
  assert.ok((await stat(new URL("enevlope opening.mp4", assetDir))).size > 1_000_000);
});
