import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [shared, runtime, dashboard, rules, projection] = await Promise.all([
  readFile(new URL("../invitations/shared/invitation-data.js", import.meta.url), "utf8"),
  readFile(new URL("../script.js", import.meta.url), "utf8"),
  readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  readFile(new URL("../invitations/shared/invitation-token.js", import.meta.url), "utf8"),
]);

test("invitation capabilities are accepted only from URL fragments and exact token-addressed reads", () => {
  assert.match(shared, /new URLSearchParams\(String\(location\.hash \|\| ""\)\.replace\(\/\^#\//);
  assert.match(shared, /INVITATION_TOKEN_PATTERN = \/\^\[A-Za-z0-9_-\]\{43\}\$\//);
  assert.match(shared, /getDoc\(doc\(db, "weddings", weddingId, "publicGuests", guestToken\)\)/);
  assert.doesNotMatch(shared, /httpsCallable|collection\(db, "weddings", weddingId, "(?:guests|publicGuests|dashboardUsers)"/);
  assert.doesNotMatch(runtime, /clearInvitationCredentialFromUrl|history\.replaceState\(null, "", url\.toString\(\)\)/);
  assert.match(runtime, /const invitationApi = await withTimeout\(getInvitationDataApi\(\), 12000/);
  assert.match(runtime, /await loadFirebaseInvitation\(weddingId, guestToken, invitationApi\);\s*state\.unsubGuest = invitationApi\.subscribeToInvitation/);
  assert.match(shared, /Promise\.all\(\[[\s\S]*?getDoc\(doc\(db, "weddings", weddingId, "publicGuests", guestToken\)\)[\s\S]*?getDoc\(doc\(db, "weddings", weddingId, "publicEvent", "details"\)\)/);
  assert.match(runtime, /import\("\.\/invitations\/shared\/invitation-data\.js\?/);
  assert.doesNotMatch(runtime.slice(0, runtime.indexOf("async function boot")), /from ["']\.\/firebase-config\.js/);
  assert.match(shared, /createInvitationSubscription/);
  assert.match(shared, /window\.addEventListener\("pagehide", dispose/);
  assert.doesNotMatch(`${dashboard}\n${runtime}`, /getGuestInvitationTokens|manageGuestInvitationAccess|getGuestInvitation|submitGuestInvitationRsvp/);
});

test("RSVP writes only allowed fields to the token projection and canonical guest atomically", () => {
  assert.match(shared, /const batch = writeBatch\(db\)/);
  assert.match(shared, /batch\.update\(tokenRef, rsvpPatch\)/);
  assert.match(shared, /batch\.update\(guestRef, rsvpPatch\)/);
  assert.match(shared, /await batch\.commit\(\)/);
  assert.match(shared, /rsvpStatus: normalizedStatus/);
  assert.match(rules, /function isPublicGuestRsvpUpdate\(weddingId, token\)[\s\S]*?allowedChanges\.hasOnly\(\["rsvpStatus", "additionalGuests", "rsvpMessage", "updatedAt"\]\)/);
  assert.match(rules, /request\.resource\.data\.additionalGuests <= invitation\.guest\.additionalGuestAllowance/);
  assert.match(rules, /function isGuestRsvpUpdate\(weddingId\)\s*\{[^}]*return false;/s);
});

test("omitting the optional additional-guest count preserves the current value", () => {
  assert.match(runtime, /await updateRsvp\(statusValue\);/);
  assert.match(shared, /count === undefined \? Number\(context\.guest\.additionalGuests \|\| 0\) : count/);
});

test("public invitation documents allow exact capability gets but never listing", () => {
  assert.match(rules, /function invitationEventExists\(weddingId\)[\s\S]*?return eventAvailable\(weddingId\)/);
  assert.match(rules, /match \/publicGuests\/\{guestToken\}[\s\S]*?allow get: if isActiveInvitationToken\(weddingId, guestToken\) \|\| canReadInvitationTokenRecord\(weddingId, guestToken\);\s*allow list: if false/);
  assert.match(rules, /match \/invitationTokens\/\{token\}[\s\S]*?allow get: if canReadInvitationTokenRecord\(weddingId, token\);\s*allow list: if canManageGuestRecords\(weddingId\)/);
  assert.match(rules, /match \/invitationSecrets\/\{guestId\}[\s\S]*?allow get: if canManageInvitationForGuest\(weddingId, guestId\)/);
  assert.match(rules, /match \/publicSummary\/\{docId\}[\s\S]*?allow get: if docId == "summary" && \(isPublicWedding\(weddingId\) \|\| isEventOwner\(weddingId\) \|\| canReadSeating\(weddingId\)\)/);
  assert.match(dashboard, /"publicGuests", token/);
});

test("invitation projection excludes contacts, internal IDs, raw tokens, and other guests", () => {
  assert.match(projection, /fullName:/);
  assert.match(projection, /additionalGuestAllowance:/);
  assert.match(projection, /seatingAssignments:/);
  assert.doesNotMatch(projection, /phone:|email:|guestToken|guestId:/);
  assert.match(projection, /canonicalLayout \? String\(table\.id\) : `t\$\{index \+ 1\}`/);
});

test("dashboard token creation is transactional and offers explicit revoke/regenerate", () => {
  assert.match(dashboard, /invitationTokenCache: new Map\(\)/);
  assert.match(dashboard, /state\.invitationTokenCache\.clear\(\)/);
  assert.match(dashboard, /createInvitationTokenService\(/);
  assert.match(dashboard, /async function ensureGuestInvitationToken\(guestId\)/);
  assert.match(dashboard, /const cachedToken = state\.invitationTokenCache\.get\(guestId\) \|\| guest\.guestToken;[\s\S]*?await persistence\.flush\(\);[\s\S]*?getPendingPublicationError\(persistence\);[\s\S]*?return cachedToken;/);
  assert.match(dashboard, /service\.regenerate\(scope, requestId\)/);
  assert.match(dashboard, /subscribeToGuestInvitationResponses\(state\.listenerGeneration\)/);
  assert.match(dashboard, /if \(guest && state\.mode === "live"\)/);
  assert.doesNotMatch(dashboard, /The invitation link is still being prepared/);
  assert.match(dashboard, /menuItem\("Regenerate invitation link", "regenerate-guest-invite"/);
  assert.match(dashboard, /menuItem\("Revoke invitation link", "revoke-guest-invite"/);
  assert.match(dashboard, /state\.permissions\?\.seatingOnly === true \|\| isGenderRevealEvent\(state\.wedding\)\) return;[\s\S]*?onSnapshot\(collection\(state\.services\.db, "weddings", expectedWeddingId, "invitationSecrets"\)/);
  assert.match(rules, /function canManageInvitationForGuest\(weddingId, guestId\)[\s\S]*?seatingAccountMayReadGuest\(weddingId, get\(guestPath\)\.data\)/);
  assert.match(rules, /match \/invitationSecrets\/\{guestId\}[\s\S]*?allow get: if canManageInvitationForGuest\(weddingId, guestId\);\s*allow list: if canManageGuestRecords\(weddingId\)/);
});

test("copied live invitation URLs carry the event ID and guest capability in the route fragment", () => {
  assert.match(dashboard, /function buildInviteLink\(guestToken, guestId = ""\)[\s\S]*?url\.searchParams\.set\("wedding", state\.weddingId\)[\s\S]*?const fragment = \{ guest: guestToken \}[\s\S]*?fragment\.recipient = guestId[\s\S]*?url\.hash = new URLSearchParams\(fragment\)\.toString\(\)/);
  assert.match(dashboard, /copyPreparedInvitationLink\(buildInviteLink\(token, guest\.id\)/);
});
