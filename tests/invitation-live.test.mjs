import test from "node:test";
import assert from "node:assert/strict";
import { createInvitationSubscription, composeInvitation, invitationReadError } from "../invitations/shared/invitation-live.js";

function source(options = {}) {
  const subscriptions = [], changes = [], errors = [];
  const api = { doc: (_db, ...parts) => parts.join("/"), collection: (_db, ...parts) => parts.join("/"), onSnapshot(path, next, error) {
    const item = { path, next, error, active: true }; subscriptions.push(item); return () => { item.active = false; };
  } };
  const context = { weddingId: "event", guestToken: "synthetic-only", guestId: "g" };
  const dispose = createInvitationSubscription({ api, db: {}, context, onChange: (value) => changes.push(value), onError: (error) => errors.push(error), ...options });
  const send = (suffix, data, missing = false) => subscriptions.findLast((item) => item.active && item.path.endsWith(suffix)).next(Array.isArray(data) ? { docs: data.map(([id, value]) => ({ id, data: () => value })) } : { exists: () => !missing, data: () => data });
  return { subscriptions, changes, errors, dispose, send };
}
const capability = { eventId: "event", wedding: { eventTitle: "Old title", canonicalLayout: true, seatingEnabled: true, tables: [], hallObjects: [] }, guest: { fullName: "Synthetic Guest", additionalGuestAllowance: 2, seatingAssignments: [{ tableId: "t", tableName: "Original table", seatNumber: "1", personKey: "main" }] }, rsvpStatus: "confirmed", additionalGuests: 1, rsvpMessage: "" };

test("RSVP updates do not reread collections or recreate shared layout subscriptions", () => {
  const s = source();
  assert.equal(s.subscriptions.length, 3);
  s.send("publicGuests/synthetic-only", capability);
  s.send("publicEvent/details", { eventTitle: "Current title" });
  s.send("publicScene/state", { version: 1 });
  s.send("publicLayouts", [["t", { name: "Current table", x: 45, y: 30, shape: "round", width: 180, height: 180, seatCount: 3 }]]);
  s.send("publicVenue", [["stage", { id: "stage", index: 0, label: "Public Stage", x: 25 }]]);
  assert.equal(s.subscriptions.length, 5);
  assert.equal(s.changes.at(-1).wedding.eventTitle, "Current title");
  assert.equal(s.changes.at(-1).guest.seatingAssignments[0].tableName, "Current table");
  for (let index = 0; index < 10; index++) s.send("publicGuests/synthetic-only", { ...capability, rsvpMessage: `Response ${index}` });
  assert.equal(s.subscriptions.length, 5);
  assert.equal(s.changes.at(-1).guest.rsvpMessage, "Response 9");
  s.dispose(); assert.equal(s.subscriptions.filter((item) => item.active).length, 0);
  const before = s.changes.length;
  s.subscriptions[0].next({ exists: () => true, data: () => capability });
  assert.equal(s.changes.length, before);
});

test("layout listeners follow the seating toggle and old async callbacks cannot revive disposed state", () => {
  const s = source(); s.send("publicGuests/synthetic-only", capability);
  s.send("publicEvent/details", { seatingEnabled: false });
  assert.equal(s.subscriptions.filter((item) => item.active).length, 3);
  s.send("publicEvent/details", { seatingEnabled: true });
  assert.equal(s.subscriptions.filter((item) => item.active).length, 5);
  const beforeObsoleteLayout = s.changes.length;
  s.subscriptions[3].next({ docs: [{ id: "obsolete", data: () => ({ name: "Obsolete layout" }) }] });
  assert.equal(s.changes.length, beforeObsoleteLayout);
  s.dispose(); const length = s.changes.length;
  for (const item of s.subscriptions) if (item.path.endsWith("publicEvent/details")) item.next({ exists: () => true, data: () => ({ eventTitle: "Obsolete title" }) });
  assert.equal(s.changes.length, length);
});

test("quota/network failures remain transient and do not start application retries or imply revocation", () => {
  const s = source(); s.send("publicGuests/synthetic-only", capability);
  const count = s.subscriptions.length;
  s.subscriptions[0].error({ code: "resource-exhausted" });
  assert.equal(s.errors[0].transient, true); assert.match(s.errors[0].message, /quota/);
  assert.equal(s.subscriptions.length, count);
  assert.equal(s.subscriptions.filter((item) => item.active).length, count);
  assert.equal(invitationReadError({ code: "unavailable" }).transient, true);
  s.send("publicGuests/synthetic-only", null, true);
  assert.equal(s.errors.at(-1).transient, false);
  assert.equal(s.subscriptions.filter((item) => item.active).length, 0);
});

test("existing embedded invitations reconcile canonical personal seat IDs and public rename aliases", () => {
  const legacy = { ...capability, wedding: { ...capability.wedding, canonicalLayout: false, tables: [{ id: "t1", name: "Original table" }] } };
  let value = composeInvitation({ weddingId: "event" }, legacy, null, null, null, null);
  assert.equal(value.guest.seatingAssignments[0].tableId, "t1");
  value = composeInvitation({ weddingId: "event" }, legacy, null, { version: 1 }, [{ id: "stable-id", data: () => ({ name: "Renamed table", aliases: ["Original table"], shape: "round", seatCount: 3, width: 180, height: 180 }) }], []);
  assert.equal(value.guest.seatingAssignments[0].tableId, "stable-id");
  assert.equal(value.guest.seatingAssignments[0].tableName, "Renamed table");
  assert.equal(legacy.guest.seatingAssignments[0].tableId, "t");
});

test("public schedule subscribes only when needed, stays stable across RSVP and discards old callbacks", () => {
  const s = source(); s.send("publicGuests/synthetic-only", capability);
  s.send("publicEvent/details", { scheduleCount: 1, schedule: [] });
  s.send("publicSchedule", [["0", { index: 0, titleEn: "Current public item" }]]);
  assert.equal(s.changes.at(-1).wedding.schedule[0].titleEn, "Current public item");
  const count = s.subscriptions.length;
  for (let index = 0; index < 10; index++) s.send("publicGuests/synthetic-only", { ...capability, rsvpMessage: `Response ${index}` });
  assert.equal(s.subscriptions.length, count);
  const old = s.subscriptions.find((item) => item.path.endsWith("publicSchedule"));
  s.send("publicEvent/details", { scheduleCount: 0, schedule: [] });
  assert.equal(old.active, false); assert.equal(s.changes.at(-1).wedding.schedule.length, 0);
  const before = s.changes.length;
  old.next({ docs: [{ id: "0", data: () => ({ index: 0, titleEn: "Obsolete" }) }] });
  assert.equal(s.changes.length, before);
  s.dispose(); assert.equal(s.subscriptions.filter((item) => item.active).length, 0);
});

test("summary-only designs omit unused venue and schedule subscriptions and survive seating toggles", () => {
  const s = source({ includeVenue: false, includeSchedule: false });
  s.send("publicGuests/synthetic-only", capability);
  s.send("publicEvent/details", { scheduleCount: 12 });
  assert.equal(s.subscriptions.length, 4);
  assert.equal(s.subscriptions.some((item) => /publicVenue|publicSchedule/.test(item.path)), false);
  s.send("publicEvent/details", { seatingEnabled: false });
  s.send("publicEvent/details", { seatingEnabled: true });
  s.send("publicLayouts", [["t", { name: "Current seat summary", shape: "round", width: 180, height: 180, seatCount: 3 }]]);
  assert.equal(s.changes.at(-1).guest.tableName, "Current seat summary");
  s.dispose(); assert.equal(s.subscriptions.filter((item) => item.active).length, 0);
});
