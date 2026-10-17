import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInvitationProjection,
  generateInvitationToken,
  isValidInvitationToken,
} from "../invitations/shared/invitation-token.js";

test("invitation tokens are canonical 32-byte base64url capabilities", () => {
  let next = 0;
  const token = generateInvitationToken({ getRandomValues(bytes) {
    bytes.forEach((_, index) => { bytes[index] = (next + index) & 255; });
    next += 1;
    return bytes;
  } });
  assert.equal(token.length, 43);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(isValidInvitationToken(token), true);
  assert.equal(isValidInvitationToken(`${token}=`), false);
  assert.notEqual(generateInvitationToken({ getRandomValues(bytes) { bytes.fill(255); return bytes; } }), token);
});

test("invitation projection keeps internal IDs, contacts, tokens, and roster data private", () => {
  const projection = buildInvitationProjection("event-a", {
    eventTitle: "A & B", ownerUserId: "owner-secret", phone: "private", status: "active",
    eventDateISO: "2027-05-20T18:00:00.000Z", venueEn: "Test venue", invitationMessageEn: "Welcome",
  }, {
    id: "internal-guest-id", fullName: "Guest", phone: "971500000000", guestToken: "secret-token",
    additionalGuests: 1, additionalGuestAllowance: 2, seatingAssignments: [], notes: "private",
  }, [{ id: "internal-table-id", name: "Table 1", guestIds: ["other-guest"], chairs: [{ guestId: "other-guest" }] }]);
  const serialized = JSON.stringify(projection);
  assert.match(serialized, /Guest/);
  assert.match(serialized, /Table 1/);
  for (const forbidden of ["owner-secret", "971500000000", "secret-token", "internal-guest-id", "other-guest", "private"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(projection.eventId, "event-a");
  assert.equal(projection.guest.additionalGuestAllowance, 2);
});

test("invitation tokens have no client-side event-date expiry", async () => {
  const { readFile } = await import("node:fs/promises");
  const [dashboard, rules] = await Promise.all([
    readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(dashboard, /invitationExpiryDate|INVITATION_VALID_DAYS_AFTER_EVENT/);
  const tokenService = await import("../invitations/shared/invitation-token-service.js");
  assert.match(await (await import("node:fs/promises")).readFile(new URL("../invitations/shared/invitation-token-service.js", import.meta.url), "utf8"), /if \(action === "ensure" && oldToken\)/);
  assert.equal(typeof tokenService.createInvitationTokenService, "function");
  assert.match(await (await import("node:fs/promises")).readFile(new URL("../invitations/shared/invitation-token-service.js", import.meta.url), "utf8"), /expiresAt: null/);
  assert.match(rules, /function invitationEventExists\(weddingId\)[\s\S]*?return exists\(/);
  assert.doesNotMatch(rules, /request\.time < record\.data\.expiresAt/);
});
