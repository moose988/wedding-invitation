import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const root = new URL("../invitations/wedding-designs/layla-zaid/", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const css = await readFile(new URL("styles.css", root), "utf8");
const script = await readFile(new URL("../../../script.js", root), "utf8");
const introSequence = await readFile(new URL("../../../intro-sequence.js", root), "utf8");
const assetDir = new URL("assets/", root);

test("Layla landing uses the envelope cover and restored envelope opening video", () => {
  assert.match(html, /src="\.\/invitations\/wedding-designs\/layla-zaid\/assets\/Ivory Wedding Envelope with LZ Seal\.png" alt="Ivory wedding envelope sealed with the Layla and Zaid monogram"/);
  assert.match(html, /src="\.\/invitations\/wedding-designs\/layla-zaid\/assets\/enevlope%20opening\.mp4\?v=restored-20261027"/);
  assert.match(html, /poster="\.\/invitations\/wedding-designs\/layla-zaid\/assets\/Ivory Wedding Envelope with LZ Seal\.png"/);
  assert.match(html, /data-layla-text="introCaption">Your invitation awaits/);
  assert.match(html, /data-layla-text="introCaption"/);
  assert.match(html, /playsinline webkit-playsinline muted preload="auto"/);
  assert.match(html, /id="skipOpening"/);
  assert.doesNotMatch(html, /envelope-layer--seal|envelope-layer--card|heroBackdrop/);
  assert.match(css, /url\("\.\/assets\/Sculpted Ivory Paper Wedding Invitation\.png"\)/);
  assert.match(script, /venueMapEmbedUrl: wedding\.venueMapEmbedUrl \|\| ""/);
  assert.match(html, /Luxury Pearl Oyster Shell Ornament\.png/);
  assert.match(html, /Watercolor Ivory Courtyard Wedding Venue\.png/);
  assert.match(html, /href="https:\/\/qdsystems\.ae"/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /envelope-intro__video \{ object-fit: cover; \}/);
  assert.match(css, /envelope-intro__video \{ z-index: 1; opacity: 0; transition: opacity \.28s ease/);
  assert.match(css, /envelope-intro\.is-playing \.envelope-intro__caption \{ opacity: 0; \}/);
  assert.match(css, /inset-block-start: 72%;\s*color: #2d1d11;/);
  assert.match(script, /startupTimeout: isLaylaInvitation\(\) \? 10000 : undefined/);
  assert.match(script, /bufferTimeout: isLaylaInvitation\(\) \? 10000 : undefined/);
  assert.match(introSequence, /ended: \(\) => finish\("ended"\)/);
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
  const optimizedVideo = await stat(new URL("opening-envelope.mp4", assetDir));
  assert.ok(optimizedVideo.size < 1_000_000);
});

test("the base element resolves the optimized opening video to the site-root asset", () => {
  const documentUrl = new URL("https://invitation.example/invitations/wedding-designs/layla-zaid/index.html");
  const baseHref = html.match(/<base href="([^"]+)"/)?.[1];
  const mediaPath = html.match(/<source src="([^"]+enevlope%20opening\.mp4(?:\?[^\"]*)?)"/)?.[1];
  assert.ok(baseHref);
  assert.ok(mediaPath);
  const baseUrl = new URL(baseHref, documentUrl);
  const mediaUrl = new URL(mediaPath, baseUrl);
  assert.equal(mediaUrl.pathname, "/invitations/wedding-designs/layla-zaid/assets/enevlope%20opening.mp4");
});
