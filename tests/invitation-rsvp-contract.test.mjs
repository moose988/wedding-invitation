import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [shared, runtime, dashboard, rules, functions] = await Promise.all([
  readFile(new URL("../invitations/shared/invitation-data.js", import.meta.url), "utf8"),
  readFile(new URL("../script.js", import.meta.url), "utf8"),
  readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
]);

test("invitation capabilities are accepted only from URL fragments and callable reads", () => {
  assert.match(shared, /new URLSearchParams\(String\(location\.hash \|\| ""\)\.replace\(\/\^#\//);
  assert.match(shared, /INVITATION_TOKEN_PATTERN = \/\^\[A-Za-z0-9_-\]\{43\}\$\//);
  assert.match(shared, /httpsCallable\(functions, "getGuestInvitation"\)/);
  assert.doesNotMatch(shared, /getDoc\(|getDocs\(|collection\(|publicGuests/);
  assert.match(runtime, /clearInvitationCredentialFromUrl\(\)/);
  assert.match(functions, /exports\.getGuestInvitation = onCall/);
  assert.match(functions, /genericInvitationUnavailable\(\)/);
});

test("RSVP writes revalidate the capability and update only allowed private fields", () => {
  assert.match(shared, /httpsCallable\(functions, "submitGuestInvitationRsvp"\)/);
  assert.match(shared, /rsvpStatus: normalizedStatus/);
  assert.match(shared, /additionalGuests: count/);
  assert.match(functions, /exports\.submitGuestInvitationRsvp = onCall/);
  assert.match(functions, /transaction\.get\(initial\.indexRef\)/);
  assert.match(functions, /transaction\.get\(initial\.secretRef\)/);
  assert.match(functions, /secret\.status !== "active"/);
  assert.match(functions, /additionalGuests > allowance/);
  assert.match(functions, /const patch = \{\s*rsvpStatus,\s*updatedAt: FieldValue\.serverTimestamp\(\),/);
  assert.match(functions, /if \(additionalGuests !== undefined\) patch\.additionalGuests = additionalGuests/);
  assert.match(functions, /if \(rsvpMessage !== undefined\) patch\.rsvpMessage = rsvpMessage\.trim\(\)/);
  assert.doesNotMatch(functions.slice(functions.indexOf("exports.submitGuestInvitationRsvp"), functions.indexOf("exports.resolveCheckinGuest")), /tableId|checkedIn|seatingAssignments|ownerUserId|tokenHash: /);
  assert.match(rules, /allow read, write: if false/);
  assert.match(rules, /function isGuestRsvpUpdate\(weddingId\)\s*\{[^}]*return false;/s);
  assert.match(rules, /request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(/);
});

test("omitting the optional additional-guest count preserves the current value", () => {
  assert.match(runtime, /await updateRsvp\(statusValue\);/);
  assert.match(shared, /\.\.\.\(count === undefined \? \{\} : \{ additionalGuests: count \}\)/);
  assert.match(functions, /if \(additionalGuests !== undefined\) patch\.additionalGuests = additionalGuests/);
});

test("public and legacy guest mirrors are inaccessible and contain no invitation records", () => {
  assert.match(rules, /match \/publicGuests\/\{guestToken\}[\s\S]*?allow read, write: if false/);
  assert.match(rules, /match \/publicSummary\/\{docId\}[\s\S]*?allow get: if docId == "summary" && isPublicWedding\(weddingId\)/);
  assert.match(functions, /publicSummary\/summary/);
  assert.match(functions, /publicStats\/summary`\)\.delete\(\)/);
  assert.doesNotMatch(dashboard, /publicGuests/);
  assert.match(dashboard, /function syncPublicStats\(\)\s*\{[\s\S]*?return;/);
  assert.match(functions, /writePublicSummaryIfCurrent\(weddingId, controlRef, revision/);
});

test("invitation projection excludes contact details, internal IDs, and other guests", () => {
  const projection = functions.slice(functions.indexOf("function projectInvitationGuest"), functions.indexOf("async function projectInvitationTables"));
  assert.match(projection, /fullName:/);
  assert.match(projection, /rsvpStatus:/);
  assert.match(projection, /additionalGuestAllowance:/);
  assert.match(projection, /seatingAssignments:/);
  assert.doesNotMatch(projection, /phone:|email:|guestToken|return \{[^}]*guestId:/s);
  assert.match(functions, /tables: tables\.map\(\(\{ sourceId, \.\.\.table \}\) => table\)/);
  assert.match(functions, /id: `t\$\{index \+ 1\}`/);
});

test("dashboard keeps share tokens in memory and supports revocation and regeneration", () => {
  assert.match(dashboard, /invitationTokenCache: new Map\(\)/);
  assert.match(dashboard, /state\.invitationTokenCache\.clear\(\)/);
  assert.match(dashboard, /httpsCallable\(state\.services\.functions, "manageGuestInvitationAccess"\)/);
  assert.match(dashboard, /menuItem\("Regenerate invitation link", "regenerate-guest-invite"/);
  assert.match(dashboard, /menuItem\("Revoke invitation link", "revoke-guest-invite"/);
  assert.match(functions, /lastIssueRequestId === requestId/);
});
