import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("Layla & Zaid sample panel lives once at workspace level with distinct preview and copy actions", async () => {
  const [workspace, html, styles] = await Promise.all([read("weddings.js"), read("all-events.html"), read("weddings.css")]);
  const panel = html.slice(html.indexOf('id="sampleInvitationPanel"'), html.indexOf('<section class="workspace-controls"'));
  assert.ok(panel.length > 0, "sample panel appears before workspace controls");
  assert.equal((html.match(/id="sampleInvitationPanel"/g) || []).length, 1);
  assert.doesNotMatch(workspace, /sampleInvitationControls|sampleArea/);
  assert.match(workspace, /index\.html\?wedding=luxury-wedding-demo&sample=1/);
  assert.match(html, /Preview invitation/);
  assert.match(html, /Copy sample link/);
  assert.match(html, /data-action="preview-sample"/);
  assert.match(workspace, /sampleInvitationPanel\.addEventListener\("click", handleSamplePanelAction\)/);
  assert.match(workspace, /weddingAccess/);
  assert.match(workspace, /getDoc\(doc\(state\.services\.db, "weddings", entry\.id\)\)/);
  assert.match(workspace, /wedding\.seatingOnly === true/);
  assert.match(html, /id="sampleInvitationPanel"[^>]*\shidden(?:\s|>)/);
  assert.match(workspace, /state\.canSeeSampleInvitation = false;\s*el\.sampleInvitationPanel\.hidden = true/);
  assert.match(workspace, /if \(permissions\.seatingOnly === true\) \{[\s\S]*?return \{ \.\.\.eventSummary/);
  assert.match(workspace, /if \(state\.isAdmin\) state\.canSeeSampleInvitation = true/);
  assert.match(workspace, /el\.sampleInvitationPanel\.hidden = !state\.canSeeSampleInvitation/);
  assert.doesNotMatch(workspace, /girl@gmail\.com|isRestrictedAccount/);
  assert.match(styles, /\.workspace-controls\[hidden\], \.filter-row\[hidden\]\s*\{\s*display:none !important;\s*\}/);
  assert.match(workspace, /handleSamplePanelAction[\s\S]*?window\.open\(sampleInvitationUrl\(\)/);
  assert.match(workspace, /Copy guest link/);
  assert.match(workspace, /Copy failed\. Select and copy the URL above\./);
  assert.match(workspace, /el\.sampleInvitationPanel\.querySelector\("\[data-sample-feedback\]"\)/);
  assert.match(styles, /\.sample-invitation__url/);
  assert.match(styles, /\.sample-invitation__button--preview/);
  assert.match(styles, /\.sample-invitation__button--copy/);
  assert.match(styles, /@media\(max-width:640px\)\s*\{[^}]*sample-invitation/s);
});

test("mobile event workspace places the sample, search, status filters, then create action", async () => {
  const styles = await read("weddings.css");
  const mobileOrder = styles.slice(styles.lastIndexOf("@media(max-width:640px){\n  .weddings-shell"));
  const selectors = [
    ".workspace-header { order:0; }",
    ".workspace-hero > div { order:1;",
    ".sample-invitation { order:2;",
    ".workspace-controls { order:3;",
    ".filter-row { order:4;",
    "#createWeddingButton { order:5;",
  ];
  const positions = selectors.map((selector) => mobileOrder.indexOf(selector));
  assert.ok(positions.every((position) => position >= 0), "all mobile workspace sections have explicit positions");
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(mobileOrder, /\.workspace-hero \{ display:contents; \}/);
});

test("sample route reads current public event only and never resolves a guest token or private seating", async () => {
  const [script, router, html] = await Promise.all([
    read("script.js"),
    read("home-route.js"),
    read("invitations/wedding-designs/layla-zaid/index.html"),
  ]);
  const sampleBoot = script.slice(script.indexOf("if (state.sampleMode) {"), script.indexOf("if (!explicitDemoMode && (!weddingId || !guestToken))"));
  assert.match(script, /explicitSampleMode = invitationParams\.get\("sample"\) === "1" && invitationParams\.get\("wedding"\) === "luxury-wedding-demo"/);
  assert.match(sampleBoot, /normaliseWedding\(\{ \.\.\.demoWedding, id: weddingId \}\)/);
  assert.doesNotMatch(sampleBoot, /loadGuestInvitation|loadFirebaseInvitation|loadTables|httpsCallable/);
  assert.match(script, /state\.sampleMode \|\| state\.mode !== "firebase" \|\| !state\.guest/);
  assert.match(script, /state\.sampleMode \|\| state\.mode !== "firebase"/);
  assert.match(html, /id="samplePreviewBanner" hidden/);
  assert.match(router, /hasInvitationParameters = Boolean\(query\.get\("wedding"\)\) \|\| Boolean\(fragment\.get\("guest"\)\)/);
  assert.match(router, /window\.location\.replace\("\.\/dashboard-login\.html"\)/);
});

test("sample RSVP uses fictional in-memory state and never writes to Firebase or demo storage", async () => {
  const script = await read("script.js");
  assert.match(script, /const sampleRsvpGuestName = "Avery Morgan"/);
  assert.match(script, /sampleRsvpResponse: null/);
  assert.match(script, /id="\$\{sample \? "sampleRsvpForm" : "rsvpForm"\}"/);
  assert.match(script, /form\?\.addEventListener\("submit", sample \? handleSampleRsvpSubmit : handleDemoRsvpSubmit\)/);
  const sampleSubmit = script.slice(script.indexOf("function handleSampleRsvpSubmit("), script.indexOf("async function handleFirebaseRsvpSubmit("));
  assert.match(sampleSubmit, /if \(!state\.sampleMode\) return/);
  assert.match(sampleSubmit, /state\.sampleRsvpResponse = \{ status, message \}/);
  assert.doesNotMatch(sampleSubmit, /localStorage|saveInvitationRsvp|commitInvitationRsvpPatch|updateDoc|writeBatch|httpsCallable/);
  assert.match(script, /sampleRsvpNote: \{ en: "Sample invitation — try the RSVP experience\. No real response will be sent\./);
  assert.match(script, /state\.sampleMode \? \(state\.sampleRsvpResponse\?\.status \|\| ""\)/);
  assert.match(script, /if \(state\.sampleMode\) return;\s*const form = event\.currentTarget;/);
  assert.match(script, /function handleDemoRsvpSubmit\(event\) \{\s*event\.preventDefault\(\);\s*if \(state\.sampleMode\) return;/);
  assert.match(script, /state\.sampleMode \|\| state\.mode !== "firebase" \|\| state\.isRsvpSaving/);
  assert.match(script, /await saveInvitationRsvp\(/);
  assert.match(script, /const checkinUrl = buildAbsoluteUrl\(`checkin\.html\?wedding=.*#guest=\$\{encodeURIComponent\(state\.guestToken\)\}`\)/);
  assert.match(script, /guestToken: explicitSampleMode \? "" : params\.guestToken/);
  assert.match(script, /if \(weddingId && guestToken && isFirebaseConfigured\(\)\)/);
});
