import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as api from "firebase/firestore";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { customerMembership } from "../account-access.js";
import { commitGuestEdit, guestFormPatch, seatingGuestData, checkinGuestData, saveFailureMessage } from "../guest-edit.js";
import { createDashboardPersistence } from "../dashboard-persistence.js";
import { createInvitationTokenService } from "../invitations/shared/invitation-token-service.js";
import { createInvitationSubscription } from "../invitations/shared/invitation-live.js";
import { publicEventData, publicTableData } from "../event-publishing.js";
import { buildInvitationProjection } from "../invitations/shared/invitation-token.js";
import { syncCustomerEventProjections } from "../customer-projections.js";
import { persistCanonicalSeatDiff } from "../seating-transactions.js";

function instrument(source) {
  const counts = { reads: 0, queries: 0, writes: 0, publicGuestWrites: 0, bindingsRead: 0, listeners: 0 };
  const read = (ref) => { counts.reads++; if (/\/(seatAssignments|seatedPeople)\//.test(ref.path)) counts.bindingsRead++; };
  const write = (ref) => { counts.writes++; if (ref.path.includes("/publicGuests/")) counts.publicGuestWrites++; };
  const decorated = { ...source,
    getDoc: (...args) => { read(args[0]); return source.getDoc(...args); },
    getDocs: async (...args) => { counts.queries++; const rows = await source.getDocs(...args); counts.reads += rows.size; return rows; },
    runTransaction: (db, callback, options) => source.runTransaction(db, (transaction) => {
      const proxy = { get(ref) { read(ref); return transaction.get(ref); } };
      for (const type of ["set", "update", "delete"]) proxy[type] = (...args) => { write(args[0]); transaction[type](...args); return proxy; };
      return callback(proxy);
    }, options),
    onSnapshot: (...args) => { counts.listeners++; const stop = source.onSnapshot(...args); return () => { counts.listeners--; stop(); }; },
  };
  return { api: decorated, counts, reset() { for (const key of Object.keys(counts)) counts[key] = 0; } };
}

test("actual guest-save and shared publishing paths remain bounded, live and isolated", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const env = await initializeTestEnvironment({ projectId: "demo-specific-regressions", firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  await env.clearFirestore();
  const event = { ownerUserId: "admin", eventTitle: "Synthetic event", coupleName: "Synthetic Couple", brideName: "Synthetic A", groomName: "Synthetic B", eventCategory: "wedding_engagement", eventDateISO: "2027-06-21T19:30:00.000Z", venueEn: "Synthetic Hall", status: "active", seatingSchemaVersion: 2, seatingEnabled: true, showInvitationQr: true, hallObjects: [], schedule: [], invitationLanguage: "en" };
  const guest = { fullName: "Synthetic Guest", phone: "440000000000", side: "bride", additionalGuests: 2, additionalGuestAllowance: 2, rsvpStatus: "confirmed", rsvpMessage: "keep response", notes: "private fixture note", seatingAssignments: [], tableId: "", tableName: "", seatNumber: "", checkedIn: false, checkedInAt: null, inviteSentAt: null, reminderSentAt: null };
  const chairs = Array.from({ length: 11 }, (_, index) => ({ id: `c${index + 1}`, seatNumber: index + 1, x: 20, y: 20 }));
  const table = { id: "t", name: "Synthetic Table", shape: "round", x: 20, y: 20, width: 180, height: 180, rotation: 0, capacity: 11, seatCount: 11, tableColor: "#ffffff", borderColor: "#aaaaaa", chairColor: "#123456", chairs };
  const db = env.authenticatedContext("customer").firestore(), admin = env.authenticatedContext("admin").firestore(), anonymous = env.unauthenticatedContext().firestore();
  const spy = instrument(api), p = createDashboardPersistence({ api: spy.api, db, weddingId: "a" });
  const adminPublisher = createDashboardPersistence({ api, db: admin, weddingId: "a" });
  const ref = (database, ...parts) => api.doc(database, "weddings", "a", ...parts);
  const edit = (id, patch, persistence = p, database = db) => commitGuestEdit({ api: { ...api, runTransaction: persistence.runTransaction }, db: database, weddingId: "a", guestId: id, patch });
  try {
    await env.withSecurityRulesDisabled(async (context) => {
      const seed = context.firestore();
      await api.setDoc(api.doc(seed, "platformAdmins/admin"), { enabled: true });
      for (const id of ["a", "b"]) await api.setDoc(api.doc(seed, "weddings", id), event);
      for (const uid of ["customer", "admin"]) await api.setDoc(ref(seed, "dashboardUsers", uid), { ...customerMembership(uid, `${uid}@example.test`, new Date()), ...(uid === "admin" ? { role: "admin", canCheckIn: true, canManageUsers: true } : {}) });
      await api.setDoc(ref(seed, "tables", "t"), table);
      for (let index = 0; index < 30; index++) {
        const id = `g${index}`, row = index === 2 ? { ...guest, additionalGuests: 10, additionalGuestAllowance: 10 } : index === 1 ? { ...guest, checkedIn: true, checkedInAt: "Today, 8:12 PM", qrCodeValue: "retired-value", fullNameAr: "Legacy name", token: "retired-value" } : guest;
        await api.setDoc(ref(seed, "guests", id), row);
        await api.setDoc(ref(seed, "seatingGuests", id), seatingGuestData(row));
        await api.setDoc(ref(seed, "checkinGuests", id), checkinGuestData(id, row));
      }
      const assignments = [];
      for (let index = 0; index < chairs.length; index++) {
        const personKey = index ? `guest-${index}` : "main", chair = chairs[index];
        await api.setDoc(ref(seed, "seatAssignments", `t~${chair.id}`), { weddingId: "a", guestId: "g2", tableId: "t", chairId: chair.id, personKey, partyMemberIndex: index, seatNumber: index + 1, side: "bride", updatedAt: new Date() });
        await api.setDoc(ref(seed, "seatedPeople", `g2~${personKey}`), { weddingId: "a", guestId: "g2", tableId: "t", chairId: chair.id, personKey, side: "bride", updatedAt: new Date() });
        await api.setDoc(ref(seed, "seatOccupancy", `t~${chair.id}`), { weddingId: "a", tableId: "t", chairId: chair.id, occupied: true, updatedAt: new Date() });
        assignments.push({ tableId: "t", tableName: table.name, seatNumber: String(index + 1), personKey, label: index ? `Additional guest ${index}` : "Main guest" });
      }
      await api.updateDoc(ref(seed, "guests", "g2"), { seatingAssignments: assignments, tableId: "t", tableName: table.name, seatNumber: "1" });
    });
    const tokenService = createInvitationTokenService({ db, firestore: api });
    const token = await tokenService.ensure({ uid: "customer", weddingId: "a", guestId: "g0", wedding: event, customer: true });
    const partyToken = await tokenService.ensure({ uid: "customer", weddingId: "a", guestId: "g2", wedding: event, customer: true });
    spy.reset();
    const copyService = createInvitationTokenService({ db, firestore: spy.api });
    assert.equal(await copyService.ensure({ uid: "customer", weddingId: "a", guestId: "g0", wedding: event, customer: true }), token);
    assert.equal(spy.counts.writes, 0, "copying unchanged content must not rewrite timestamps or secrets");
    const legacyWedding = buildInvitationProjection("a", event, guest, [table]).wedding;
    await env.withSecurityRulesDisabled(async (context) => {
      const seed = context.firestore();
      for (const existingToken of [token, partyToken]) await api.updateDoc(ref(seed, "publicGuests", existingToken), { wedding: legacyWedding });
    });
    await p.prepareScene();
    await adminPublisher.updateDoc(ref(admin), { eventTitle: "Shared synthetic title", updatedAt: api.serverTimestamp() });
    assert.equal(p.publicationError, null);
    spy.reset();
    await edit("g0", { fullName: "Edited existing synthetic guest" });
    assert.equal(p.publicationError, null);
    assert.equal(spy.counts.bindingsRead, 0);
    assert.equal(spy.counts.queries, 0);
    assert.ok(spy.counts.reads <= 6, JSON.stringify(spy.counts));
    assert.equal(spy.counts.publicGuestWrites, 1);
    assert.deepEqual((await api.getDoc(ref(db, "publicGuests", token))).data().wedding, legacyWedding);
    const thirtyCounts = { ...spy.counts };
    spy.reset();
    await edit("g0", { phone: "440000000001" });
    assert.equal(spy.counts.reads, 1); assert.equal(spy.counts.bindingsRead, 0); assert.equal(spy.counts.publicGuestWrites, 0);
    for (const [id, patch] of [["g1", { fullName: "Edited legacy record" }], ["g3", { additionalGuestAllowance: 4 }], ["g3", { additionalGuestAllowance: 1 }], ["g3", { rsvpStatus: "declined" }], ["g3", { side: "groom" }], ["g2", { fullName: "Edited eleven-person party" }], ["g2", { side: "groom" }]]) {
      await edit(id, patch); assert.equal(p.publicationError, null);
    }
    const legacy = (await api.getDoc(ref(db, "guests", "g1"))).data();
    assert.equal(legacy.checkedInAt, "Today, 8:12 PM"); assert.equal(legacy.qrCodeValue, "retired-value"); assert.equal(legacy.fullNameAr, "Legacy name");
    assert.equal((await api.getDoc(ref(db, "seatAssignments", "t~c11"))).data().side, "groom");
    assert.equal((await api.getDoc(ref(anonymous, "publicGuests", partyToken))).data().guest.seatingAssignments.length, 11);
    await assert.rejects(edit("g2", { additionalGuestAllowance: 9 }), /Unassign/);
    assert.equal((await api.getDoc(ref(db, "guests", "g2"))).data().additionalGuests, 10);
    const formBaseline = { ...guest, fullName: "Synthetic Guest" };
    await edit("g6", { phone: "440000000009", additionalGuests: 1 }, adminPublisher, admin);
    const formPatch = guestFormPatch({ fullName: "Concurrent form name", phone: guest.phone, side: guest.side, additionalGuestAllowance: 2 }, formBaseline);
    await edit("g6", Object.freeze(formPatch));
    const mergedForm = (await api.getDoc(ref(db, "guests", "g6"))).data();
    assert.equal(mergedForm.phone, "440000000009"); assert.equal(mergedForm.additionalGuests, 1);
    await edit("g1", { phone: "440000000003" }, adminPublisher, admin);
    await assertFails(commitGuestEdit({ api, db, weddingId: "b", guestId: "g0", patch: { fullName: "Forged" } }));
    await assertFails(p.updateDoc(ref(db), { showInvitationQr: false, updatedAt: api.serverTimestamp() }));
    await assertFails(api.getDocs(api.collection(anonymous, "weddings", "a", "guests")));
    await assertFails(api.getDoc(ref(anonymous)));
    await assertFails(api.getDoc(ref(anonymous, "invitationSecrets", "g0")));
    await assertFails(api.setDoc(ref(db, "publicEvent", "details"), { ...publicEventData(event), phone: "private", updatedAt: api.serverTimestamp() }));
    await assertFails(api.setDoc(ref(db, "publicLayouts", "t"), { ...publicTableData(table), notes: "private", updatedAt: api.serverTimestamp() }));

    let contexts = [], updates = [], errors = [];
    const unsubscribe = createInvitationSubscription({ api, db: anonymous, context: { weddingId: "a", guestToken: token, guestId: "g0" }, onChange(value) { contexts.push(value); for (const notify of [...updates]) notify(value); }, onError(error) { errors.push(error); } });
    const waitFor = (predicate) => new Promise((resolve, reject) => {
      const existing = contexts.findLast(predicate); if (existing) { resolve(existing); return; }
      const timeout = setTimeout(() => { updates = updates.filter((item) => item !== notify); reject(new Error("Shared invitation update timed out")); }, 15000);
      const notify = (value) => { if (predicate(value)) { clearTimeout(timeout); updates = updates.filter((item) => item !== notify); resolve(value); } }; updates.push(notify);
    });
    await waitFor((value) => value.wedding.tables?.some((row) => row.id === "t"));
    spy.reset();
    await p.updateDoc(ref(db, "tables", "t"), { x: 55, updatedAt: api.serverTimestamp() });
    await waitFor((value) => value.wedding.tables?.find((row) => row.id === "t")?.x === 55);
    assert.equal(spy.counts.publicGuestWrites, 0); assert.equal(spy.counts.writes, 2);
    await p.updateDoc(ref(db, "tables", "t"), { name: "Renamed table", rotation: 35, width: 220, updatedAt: api.serverTimestamp() });
    await waitFor((value) => value.wedding.tables?.some((row) => row.name === "Renamed table" && row.rotation === 35 && row.width === 220));
    await p.updateDoc(ref(db), { hallObjects: [{ id: "stage", type: "stage", label: "Synthetic stage", x: 25, y: 15, notes: "PRIVATE NOTE" }], updatedAt: api.serverTimestamp() });
    await waitFor((value) => value.wedding.hallObjects?.some((item) => item.id === "stage" && item.x === 25));
    assert.equal(JSON.stringify(contexts.at(-1)).includes("PRIVATE NOTE"), false);
    const extraTable = { ...table, id: "u", name: "Synthetic move destination", capacity: 4, seatCount: 4, chairs: chairs.slice(0, 4) };
    await p.setDoc(ref(db, "tables", "u"), extraTable);
    await waitFor((value) => value.wedding.tables?.some((row) => row.id === "u"));
    const assigned = { ...extraTable, chairs: extraTable.chairs.map((chair, index) => index === 0 ? { ...chair, assignment: { guestId: "g0", partyMemberIndex: 0, personKey: "main", side: "bride" } } : chair) };
    const moved = { ...extraTable, chairs: extraTable.chairs.map((chair, index) => index === 1 ? { ...chair, assignment: { guestId: "g0", partyMemberIndex: 0, personKey: "main", side: "bride" } } : chair) };
    const seat = (before, after) => p.runTransaction(db, (transaction) => persistCanonicalSeatDiff({ api, db, weddingId: "a", transaction, beforeTables: [before], afterTables: [after] }));
    await seat(extraTable, assigned);
    await waitFor((value) => value.guest.seatingAssignments?.some((row) => row.tableId === "u" && row.seatNumber === "1"));
    await seat(assigned, moved);
    await waitFor((value) => value.guest.seatingAssignments?.some((row) => row.tableId === "u" && row.seatNumber === "2"));
    await seat(moved, extraTable);
    await waitFor((value) => !value.guest.seatingAssignments?.length);
    await p.deleteDoc(ref(db, "tables", "u"));
    await waitFor((value) => !value.wedding.tables?.some((row) => row.id === "u"));
    await p.updateDoc(ref(db), { hallObjects: [], updatedAt: api.serverTimestamp() });
    await waitFor((value) => value.wedding.hallObjects?.length === 0);
    const rsvp = api.writeBatch(anonymous);
    rsvp.update(ref(anonymous, "publicGuests", token), { rsvpStatus: "declined", additionalGuests: 0, rsvpMessage: "Concurrent synthetic response", updatedAt: api.serverTimestamp() });
    rsvp.update(ref(anonymous, "guests", "g0"), { rsvpStatus: "declined", additionalGuests: 0, rsvpMessage: "Concurrent synthetic response", updatedAt: api.serverTimestamp() });
    await Promise.all([rsvp.commit(), p.updateDoc(ref(db), { eventTitle: "Concurrent event title", venueEn: "New synthetic hall", mapsUrl: "https://maps.example.test/hall", invitationLanguage: "ar", updatedAt: api.serverTimestamp() })]);
    await waitFor((value) => value.wedding.eventTitle === "Concurrent event title" && value.guest.rsvpStatus === "declined");
    assert.equal((await api.getDoc(ref(db, "guests", "g0"))).data().rsvpMessage, "Concurrent synthetic response");
    await adminPublisher.updateDoc(ref(admin), { showInvitationQr: false, updatedAt: api.serverTimestamp() });
    await waitFor((value) => value.wedding.showInvitationQr === false);
    assert.equal(errors.length, 0);
    unsubscribe();
    await syncCustomerEventProjections(spy.api, db, "a", { guestIds: ["g0", "g1", "g2"] });
    spy.reset();
    await syncCustomerEventProjections(spy.api, db, "a", { guestIds: ["g0", "g1", "g2"] });
    assert.equal(spy.counts.writes, 0, "a repeated explicit repair must not rewrite timestamps");
    for (const [database, persistence, id] of [[db, p, "g4"], [admin, adminPublisher, "g5"]]) {
      for (const patch of [{ fullName: "Synthetic role-matrix name" }, { phone: "440000000008" }, { additionalGuestAllowance: 3 }, { additionalGuestAllowance: 1 }, { rsvpStatus: "pending" }, { side: "family" }]) {
        await edit(id, patch, persistence, database); assert.equal(persistence.publicationError, null);
      }
    }

    // A larger roster has identical simple-edit cost; all data is emulator-only.
    await env.withSecurityRulesDisabled(async (context) => {
      const seed = context.firestore(), batch = api.writeBatch(seed);
      for (let index = 30; index < 300; index++) batch.set(ref(seed, "guests", `g${index}`), guest);
      await batch.commit();
    });
    spy.reset();
    await edit("g0", { fullName: "Edited with 300 synthetic guests" });
    assert.deepEqual(spy.counts, thirtyCounts);
    const afterEditCounts = { ...spy.counts };
    await p.flush(); await p.flush();
    assert.deepEqual(spy.counts, afterEditCounts);
    await env.withSecurityRulesDisabled(async (context) => {
      const seed = context.firestore();
      await api.updateDoc(ref(seed), { seatingSchemaVersion: 1 });
      await api.updateDoc(ref(seed, "guests", "g29"), { tableId: "t", tableName: "Legacy placement", seatNumber: "3", seatingAssignments: [{ tableId: "t", tableName: "Legacy placement", seatNumber: "3", personKey: "main", label: "Main guest" }] });
    });
    await p.repairGuest("g29");
    assert.equal(p.publicationError, null);
    assert.equal((await api.getDoc(ref(db, "guests", "g29"))).data().tableName, "Legacy placement", "repair cannot erase assignments from older seating schemas");
    await env.withSecurityRulesDisabled((context) => api.updateDoc(ref(context.firestore()), { seatingSchemaVersion: 2 }));
    await tokenService.revoke({ uid: "customer", weddingId: "a", guestId: "g0", wedding: event, customer: true });
    await edit("g0", { fullName: "Edited after invitation revocation" });
    await assertFails(api.getDoc(ref(anonymous, "publicGuests", token)));
    assert.equal((await api.getDoc(ref(db, "invitationSecrets", "g0"))).data().status, "revoked");

    let publishingAttempts = 0;
    const failedPublisher = createDashboardPersistence({ api, db, weddingId: "a", beforePublish() { if (++publishingAttempts === 1) throw Object.assign(new Error("Simulated quota"), { code: "resource-exhausted" }); } });
    await edit("g1", { fullName: "Persisted before derived failure" }, failedPublisher);
    assert.equal((await api.getDoc(ref(db, "guests", "g1"))).data().fullName, "Persisted before derived failure");
    assert.equal(failedPublisher.publicationError.code, "resource-exhausted"); assert.equal(publishingAttempts, 1);
    assert.match(saveFailureMessage(failedPublisher.publicationError, { committed: true }), /Guest saved.*quota/);
    await failedPublisher.flush(); assert.equal(publishingAttempts, 2); assert.equal(failedPublisher.publicationError, null);
    for (const code of ["resource-exhausted", "permission-denied", "unavailable"]) {
      const failing = createDashboardPersistence({ api, db, weddingId: "a", beforeCanonical() { throw Object.assign(new Error(`Simulated ${code}`), { code }); } });
      await assert.rejects(edit("g1", { fullName: "Unsaved draft" }, failing), (error) => error.code === code);
      assert.notEqual((await api.getDoc(ref(db, "guests", "g1"))).data().fullName, "Unsaved draft");
    }
    let currentScope = true;
    const obsoleteSpy = instrument(api);
    const obsolete = createDashboardPersistence({ api: obsoleteSpy.api, db, weddingId: "a", isCurrent: () => currentScope, beforeCanonical() { currentScope = false; } });
    await assert.rejects(edit("g1", { fullName: "Obsolete account draft" }, obsolete), (error) => error.code === "cancelled");
    assert.equal(obsoleteSpy.counts.writes, 0);
    console.log("Request counts: name edit at 30 and 300 guests", JSON.stringify(thirtyCounts), "; phone edit: 1 canonical read, 2 writes; table move: 2 writes, 0 invitation writes.");
  } finally { await env.cleanup(); }
});
