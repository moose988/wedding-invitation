import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("only Layla & Zaid gets a public sample URL and controls distinct from guest links", async () => {
  const [workspace, styles] = await Promise.all([read("weddings.js"), read("weddings.css")]);
  assert.match(workspace, /w\.id === "luxury-wedding-demo" \? sampleInvitationControls\(\) : ""/);
  assert.match(workspace, /index\.html\?wedding=luxury-wedding-demo&sample=1/);
  assert.match(workspace, /Copy sample link/);
  assert.match(workspace, /data-action="preview-sample"/);
  assert.match(workspace, /Copy guest link/);
  assert.match(workspace, /Copy failed\. Select and copy the URL above\./);
  assert.match(styles, /\.sample-invitation__url/);
  assert.match(styles, /@media\(max-width:640px\).*sample-invitation/s);
});

test("sample route reads current public event only and never resolves a guest token or private seating", async () => {
  const [script, router, html] = await Promise.all([
    read("script.js"),
    read("invitations/router.js"),
    read("invitations/wedding-designs/layla-zaid/index.html"),
  ]);
  const sampleBoot = script.slice(script.indexOf("if (state.sampleMode) {"), script.indexOf("if (!explicitDemoMode && (!weddingId || !guestToken))"));
  assert.match(script, /explicitSampleMode = invitationParams\.get\("sample"\) === "1" && invitationParams\.get\("wedding"\) === "luxury-wedding-demo"/);
  assert.match(sampleBoot, /loadWedding\(weddingId\)/);
  assert.doesNotMatch(sampleBoot, /loadGuestByToken|loadTables|guestToken/);
  const rsvp = script.slice(script.indexOf("function renderRsvp()"), script.indexOf("function renderFirebaseRsvp("));
  assert.match(rsvp, /if \(state\.sampleMode\) \{[\s\S]*?return;[\s\S]*?renderDemoRsvp/);
  assert.match(script, /state\.sampleMode \|\| state\.mode !== "firebase" \|\| !state\.guest/);
  assert.match(script, /state\.sampleMode \|\| state\.mode !== "firebase"/);
  assert.match(script, /function startSampleWeddingListener\(weddingId\)[\s\S]*?onSnapshot\(doc\(db, "weddings", weddingId\)/);
  assert.match(script, /if \(state\.sampleMode\) \{[\s\S]*?sampleRsvp/);
  assert.match(html, /id="samplePreviewBanner" hidden/);
  assert.match(router, /destination\.search = window\.location\.search/);
  assert.match(router, /window\.location\.replace\(destination\.href\)/);
});

test("sample mode cannot submit RSVP or create a guest QR pass; regular guest URLs remain supported", async () => {
  const script = await read("script.js");
  assert.match(script, /if \(state\.sampleMode\) return;\s*const form = event\.currentTarget;/);
  assert.match(script, /function handleDemoRsvpSubmit\(event\) \{\s*event\.preventDefault\(\);\s*if \(state\.sampleMode\) return;/);
  assert.match(script, /state\.sampleMode \|\| state\.mode !== "firebase" \|\| state\.isRsvpSaving/);
  assert.match(script, /const checkinUrl = buildAbsoluteUrl\(`checkin\.html\?wedding=/);
  assert.match(script, /guestToken: explicitSampleMode \? "" : \(params\.get\("guest"\)\?\.trim\(\)/);
  assert.match(script, /if \(weddingId && guestToken && isFirebaseConfigured\(\)\)/);
});
