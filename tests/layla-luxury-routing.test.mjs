import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("luxury-wedding-demo routes to the restored Layla & Zaid luxury invitation", async () => {
  const [registry, router, invitation, script] = await Promise.all([
    read("invitations/wedding-designs/registry.js"),
    read("invitations/router.js"),
    read("invitations/wedding-designs/layla-zaid/index.html"),
    read("script.js"),
  ]);

  assert.match(registry, /"luxury-wedding-demo"[\s\S]*?route:\s*"\.\/invitations\/wedding-designs\/layla-zaid\/index\.html"/);
  assert.match(router, /window\.location\.replace\(destination\.href\)/);
  assert.match(router, /destination\.href !== window\.location\.href/);
  assert.match(invitation, /<base href="\.\.\/\.\.\/\.\.\/"/);
  assert.match(invitation, /family=Amiri[\s\S]*?family=Aref\+Ruqaa[\s\S]*?family=Great\+Vibes[\s\S]*?family=Lora/);
  assert.match(invitation, /<body class="layla-zaid-invitation">/);
  assert.match(invitation, /id="openInvitation"/);
  assert.match(invitation, /id="weddingAudio"/);
  assert.match(invitation, /id="countdownGrid"/);
  assert.match(invitation, /id="rsvpMount"/);
  assert.match(invitation, /id="qrPassMount"/);
  assert.doesNotMatch(invitation, /Our Story|gallery-grid/);
  assert.match(invitation, /src="\.\/script\.js"/);
  assert.match(script, /new URL\(path, document\.baseURI\)/);
  assert.match(script, /new URL\(wedding\.media\.audio, document\.baseURI\)/);
  assert.match(script, /document\.body\.classList\.contains\("layla-zaid-invitation"\)/);
  assert.match(script, /class="layla-seat-greeting"/);
  assert.doesNotMatch(script, /Guest of Honor/);
  assert.match(script, /elements\.guestSpotlightSection\.hidden = true;/);
  assert.match(script, /laylaLanguageStorageKey/);
  assert.match(script, /function toggleLaylaLanguage\(\)/);
  assert.match(script, /document\.documentElement\.dir = "ltr"/);
});
