import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile(new URL("../script.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../invitations/wedding-designs/layla-zaid/styles.css", import.meta.url), "utf8");

test("Layla venue map frame keeps its live map and directions link intact", () => {
  assert.match(script, /<div class="venue-map-frame">/);
  assert.match(script, /class="venue-map-corner venue-map-corner--top-left" aria-hidden="true"/);
  assert.match(script, /class="venue-map-corner venue-map-corner--bottom-right" aria-hidden="true"/);
  assert.match(script, /const mapFrameMarkup = isLaylaInvitation\(\)/);
  assert.match(script, /: mapPreviewMarkup;/);
  assert.match(script, /class="venue-map-preview"><iframe src="\$\{escapeAttribute\(iframeUrl\)\}"/);
  assert.match(script, /id="openMapsLink"|class="detail-card__action" href="\$\{escapeAttribute\(directions\)\}"/);
  assert.match(script, /target="_blank" rel="noopener noreferrer"/);
});

test("Layla frame is transparent, floral layers stay non-interactive and the map remains interactive", () => {
  assert.match(styles, /body\.layla-zaid-invitation \.venue-map-card[^\n]*background: transparent/);
  assert.match(styles, /body\.layla-zaid-invitation \.venue-map-frame[^\n]*border: 1px solid #c8ad80/);
  assert.match(styles, /body\.layla-zaid-invitation \.venue-map-corner[^\n]*pointer-events: none/);
  assert.match(styles, /body\.layla-zaid-invitation \.venue-map-preview iframe[^\n]*pointer-events: auto/);
  assert.match(styles, /\.venue-map-corner--top-left \{ top: 0; left: 0/);
  assert.match(styles, /\.venue-map-corner--bottom-right \{ right: 0; bottom: 0/);
});
