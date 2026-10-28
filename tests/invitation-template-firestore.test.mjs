import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as api from "firebase/firestore";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { publicEventData } from "../event-publishing.js";
import { composeInvitation } from "../invitations/shared/invitation-live.js";

test("selected wedding template publishes safely with the event's own details", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const env = await initializeTestEnvironment({ projectId: "demo-template-selection", firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") } });
  const event = { ownerUserId: "owner", eventCategory: "wedding_engagement", eventTitle: "Mira & Sami", coupleName: "Mira & Sami", brideName: "Mira", groomName: "Sami", eventDateISO: "2027-03-12T15:30:00.000Z", eventTimeZone: "Asia/Dubai", venueEn: "Garden Hall", location: "Dubai", status: "active", invitationTemplate: "layla-zaid", seatingEnabled: true, showInvitationQr: true };
  try {
    await env.withSecurityRulesDisabled(async (ctx) => api.setDoc(api.doc(ctx.firestore(), "weddings/test-event"), event));
    const db = env.authenticatedContext("owner").firestore();
    const ref = api.doc(db, "weddings/test-event/publicEvent/details");
    await assertSucceeds(api.setDoc(ref, { ...publicEventData(event), updatedAt: api.serverTimestamp() }));
    const shared = (await api.getDoc(ref)).data();
    const context = composeInvitation({ weddingId: "test-event", guestToken: "test" }, { wedding: {}, guest: {}, rsvpStatus: "pending" }, shared);
    assert.equal(context.wedding.invitationTemplate, "layla-zaid");
    assert.equal(context.wedding.brideName, "Mira");
    assert.equal(context.wedding.eventDateISO, event.eventDateISO);
    assert.equal(context.wedding.venueEn, "Garden Hall");
    await assertFails(api.setDoc(ref, { ...publicEventData(event), invitationTemplate: "other", updatedAt: api.serverTimestamp() }));
    await assertFails(api.setDoc(ref, { ...publicEventData(event), invitationTemplate: "", updatedAt: api.serverTimestamp() }));
  } finally { await env.cleanup(); }
});
