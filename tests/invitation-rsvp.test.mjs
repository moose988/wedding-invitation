import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInvitationRsvpPatch,
  commitInvitationRsvpPatch,
  invitationRefreshIsCurrent,
  invitationRsvpStorageKey,
  invitationRsvpView,
} from "../invitations/shared/rsvp-state.js";

test("two guests keep independent response states in one browser", () => {
  const guestA = { rsvpStatus: "pending" };
  const guestB = { rsvpStatus: "confirmed" };
  assert.deepEqual(invitationRsvpView(guestA), { status: "pending", showForm: true, showSummary: false });
  assert.deepEqual(invitationRsvpView(guestB), { status: "confirmed", showForm: false, showSummary: true });
  assert.equal(invitationRsvpStorageKey("event-1", "token-a"), "premium-invitation-demo-rsvp:event-1:token-a");
  assert.notEqual(invitationRsvpStorageKey("event-1", "token-a"), invitationRsvpStorageKey("event-1", "token-b"));
});

test("the same guest token in two events has separate local demo responses", () => {
  assert.notEqual(invitationRsvpStorageKey("event-a", "guest-1"), invitationRsvpStorageKey("event-b", "guest-1"));
});

test("missing and invalid status remains pending with an unselected form", () => {
  for (const guest of [{}, { rsvpStatus: "" }, { rsvpStatus: "attending" }, null]) {
    assert.deepEqual(invitationRsvpView(guest), { status: "pending", showForm: true, showSummary: false });
  }
});

test("declined is distinct from pending and confirmed", () => {
  assert.deepEqual(invitationRsvpView({ rsvpStatus: "declined" }), { status: "declined", showForm: false, showSummary: true });
});

test("a successful RSVP patch can be reloaded and retains unrelated party and seating data", () => {
  const existing = { guestToken: "token-a", additionalGuests: 2, seatingAssignments: [{ tableId: "t1", seatNumber: 4 }], checkedIn: true };
  const patch = buildInvitationRsvpPatch("confirmed");
  const persisted = { ...existing, ...patch, updatedAt: "persisted" };
  assert.equal(invitationRsvpView(persisted).status, "confirmed");
  assert.equal(persisted.additionalGuests, 2);
  assert.deepEqual(persisted.seatingAssignments, existing.seatingAssignments);
  assert.equal(persisted.checkedIn, true);
  assert.equal("additionalGuests" in patch, false);
});

test("RSVP write validation rejects unsupported status and party size", () => {
  assert.throws(() => buildInvitationRsvpPatch("pending"), /Invalid RSVP status/);
  assert.throws(() => buildInvitationRsvpPatch("confirmed", 11), /Invalid additional guest count/);
  assert.equal(buildInvitationRsvpPatch("declined", "2").additionalGuests, 2);
});

test("a late listener refresh cannot replace a newer request", () => {
  assert.equal(invitationRefreshIsCurrent(4, 5), false);
  assert.equal(invitationRefreshIsCurrent(5, 5), true);
});

test("private and token mirror writes commit together, and batch failure is returned to the caller", async () => {
  const context = { weddingId: "event-a", guestToken: "token-a", guest: { guestId: "private-a" } };
  const payload = buildInvitationRsvpPatch("confirmed");
  const committed = [];
  const fakeDoc = (_db, ...segments) => segments.join("/");
  const fakeBatchFactory = () => {
    const pending = [];
    return {
      update: (ref, patch) => pending.push({ ref, patch }),
      commit: async () => committed.push(...pending),
    };
  };
  await commitInvitationRsvpPatch({ db: {}, context, payload, writeBatch: fakeBatchFactory, doc: fakeDoc });
  assert.deepEqual(committed.map((entry) => entry.ref), [
    "weddings/event-a/guests/private-a",
    "weddings/event-a/publicGuests/token-a",
  ]);
  assert.equal(committed[0].patch, committed[1].patch);
  assert.equal("additionalGuests" in payload, false);
  assert.equal("seatingAssignments" in payload, false);

  const failingBatchFactory = () => ({
    update() {},
    commit: async () => { throw new Error("permission denied"); },
  });
  await assert.rejects(
    commitInvitationRsvpPatch({ db: {}, context, payload, writeBatch: failingBatchFactory, doc: fakeDoc }),
    /permission denied/,
  );
});

test("private optional message is written atomically but excluded from the public token mirror", async () => {
  const context = { weddingId: "event-a", guestToken: "token-a", guest: { guestId: "private-a" } };
  const privatePayload = buildInvitationRsvpPatch("confirmed", undefined, "  See you there!  ");
  const publicPayload = { ...privatePayload };
  delete publicPayload.rsvpMessage;
  const pending = [];
  const fakeDoc = (_db, ...segments) => segments.join("/");
  const batchFactory = () => ({ update: (ref, patch) => pending.push({ ref, patch }), commit: async () => {} });
  await commitInvitationRsvpPatch({ db: {}, context, payload: publicPayload, privatePayload, writeBatch: batchFactory, doc: fakeDoc });
  assert.equal(pending[0].patch.rsvpMessage, "See you there!");
  assert.equal("rsvpMessage" in pending[1].patch, false);
  assert.throws(() => buildInvitationRsvpPatch("declined", undefined, "x".repeat(1001)), /1000 characters/);
  assert.throws(() => buildInvitationRsvpPatch("confirmed", undefined, 42), /1000 characters/);
});
