import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [shared, runtime, dashboard, rules, rsvpState] = await Promise.all([
  readFile(new URL("../invitations/shared/invitation-data.js", import.meta.url), "utf8"),
  readFile(new URL("../script.js", import.meta.url), "utf8"),
  readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  readFile(new URL("../invitations/shared/rsvp-state.js", import.meta.url), "utf8"),
]);

test("public link identity must match its wedding and token-keyed mirror", () => {
  assert.match(shared, /publicGuest\.guestToken !== guestToken \|\| !publicGuest\.guestId/);
  assert.match(shared, /context\.guest\.guestToken !== context\.guestToken/);
  assert.match(shared, /context\.guest\.id !== context\.guestToken/);
  assert.match(runtime, /guest\.guestToken !== guestToken \|\| !guest\.guestId \|\| guest\.id !== guestToken/);
});

test("demo response scope is initialized only after URL parameters exist", () => {
  assert.ok(runtime.indexOf("const invitationParams =") < runtime.indexOf("const rsvpStorageKey ="));
});

test("RSVP updates atomically patch private and public guest records and propagate failures", () => {
  assert.match(shared, /commitInvitationRsvpPatch\(\{ db, context, payload: publicPayload, privatePayload, writeBatch, doc \}\)/);
  assert.match(rsvpState, /const batch = writeBatch\(db\)/);
  assert.match(rsvpState, /batch\.update\(doc\(db, "weddings", context\.weddingId, "guests", context\.guest\.guestId\), privatePayload\)/);
  assert.match(rsvpState, /batch\.update\(doc\(db, "weddings", context\.weddingId, "publicGuests", context\.guestToken\), payload\)/);
  assert.match(shared, /delete publicPayload\.rsvpMessage/);
  assert.match(rsvpState, /await batch\.commit\(\)/);
  assert.match(rules, /function isGuestRsvpUpdate\(weddingId\)/);
  assert.match(rules, /request\.resource\.data\.guestToken == resource\.data\.guestToken/);
});

test("the no-party-size invitation submission omits companion counts", () => {
  assert.match(runtime, /await updateRsvp\(statusValue\);/);
  assert.match(runtime, /saveInvitationRsvp\([\s\S]*?\}, status, additionalGuests, message \|\| undefined\)/);
  assert.match(shared, /buildInvitationRsvpPatch\(normalizedStatus, additionalGuests, message\)/);
  assert.match(rsvpState, /if \(additionalGuests !== undefined && additionalGuests !== null\)/);
});

test("private RSVP messages are type and length checked and never enter guest mirrors", () => {
  assert.match(rsvpState, /typeof message !== "string" \|\| message\.length > 1000/);
  assert.match(rules, /request\.resource\.data\.rsvpMessage\.size\(\) <= 1000/);
  assert.doesNotMatch(/function buildPublicGuestPayload[\s\S]*?\n\}/.exec(dashboard)?.[0] || "", /rsvpMessage/);
  assert.match(dashboard, /guest\.rsvpMessage \? `<details class="guest-rsvp-message"/);
});

test("dashboard reconciliation waits for server data and preserves existing RSVP fields", () => {
  assert.match(dashboard, /!snapshot\.metadata\.fromCache && !state\.publicMirrorsReconciled/);
  assert.match(dashboard, /delete payload\.rsvpStatus;\s*delete payload\.additionalGuests;/);
  assert.match(dashboard, /batch\.set\(mirrorRef, payload, \{ merge: true \}\)/);
});

test("failed writes leave the invitation form available with an explicit error", () => {
  assert.match(runtime, /catch \(error\) \{\s*console\.error\("Invitation RSVP save failed\."/);
  assert.match(runtime, /state\.rsvpSaveError = isLaylaInvitation\(\) \? laylaText\("responseSaveError"\)/);
  assert.match(runtime, /state\.isRsvpSaving = false;\s*state\.rsvpSaveError/);
});
