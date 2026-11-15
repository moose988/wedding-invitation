// Security rules for the template work: every template a customer can pick must publish,
// and the customer templates page setting (siteSettings/templateShowcase) is public to read
// but only platform admins may change it, with exactly the fields the admin tab writes.
// Runs under the Firestore emulator: npm run test:security
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as api from "firebase/firestore";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { publicEventData } from "../event-publishing.js";

const skip = !process.env.FIRESTORE_EMULATOR_HOST;
const rules = () => readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const SETTINGS = "siteSettings/templateShowcase";

// Every value the event form can store as invitationTemplate (all-events.html), apart from "" (Classic).
const PICKABLE = [
  ["layla-zaid", "wedding_engagement"], ["moonlit-conservatory", "wedding_engagement"], ["pomegranate-courtyard", "wedding_engagement"],
  ["mandoos", "wedding_engagement"], ["yasmine", "wedding_engagement"], ["shiraa", "wedding_engagement"], ["ember", "celebration"]
];

test("every template a customer can pick publishes its invitation, and a wrong name is refused", { skip }, async () => {
  const env = await initializeTestEnvironment({ projectId: "demo-template-names", firestore: { rules: await rules() } });
  try {
    for (const [template, eventCategory] of PICKABLE) {
      const event = { ownerUserId: "owner", eventCategory, eventTitle: "Mira & Sami", coupleName: "Mira & Sami", brideName: "Mira", groomName: "Sami", eventDateISO: "2027-03-12T15:30:00.000Z", eventTimeZone: "Asia/Dubai", venueEn: "Garden Hall", location: "Dubai", status: "active", invitationTemplate: template, seatingEnabled: true, showInvitationQr: true };
      const id = `event-${template}`;
      await env.withSecurityRulesDisabled(async (ctx) => api.setDoc(api.doc(ctx.firestore(), `weddings/${id}`), event));
      const ref = api.doc(env.authenticatedContext("owner").firestore(), `weddings/${id}/publicEvent/details`);
      const data = publicEventData(event);
      assert.equal(data.invitationTemplate, template, `${template} is carried into the public invitation`);
      await assertSucceeds(api.setDoc(ref, { ...data, updatedAt: api.serverTimestamp() }));
      await assertFails(api.setDoc(ref, { ...data, invitationTemplate: "made-up-template", updatedAt: api.serverTimestamp() }));
    }
  } finally { await env.cleanup(); }
});

test("the templates page setting: anyone reads it, only an enabled platform admin writes it", { skip }, async () => {
  const env = await initializeTestEnvironment({ projectId: "demo-template-showcase", firestore: { rules: await rules() } });
  const valid = (uid, extra = {}) => ({ hidden: ["ember"], whatsapp: "971500000001", updatedAt: api.serverTimestamp(), updatedBy: uid, ...extra });
  try {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await api.setDoc(api.doc(ctx.firestore(), "platformAdmins/admin"), { enabled: true });
      await api.setDoc(api.doc(ctx.firestore(), "platformAdmins/old-admin"), { enabled: false });
    });
    const admin = env.authenticatedContext("admin").firestore();
    const ref = db => api.doc(db, SETTINGS);

    // Writes by anyone who is not an enabled platform admin are refused.
    await assertFails(api.setDoc(ref(env.unauthenticatedContext().firestore()), valid("nobody")));
    await assertFails(api.setDoc(ref(env.authenticatedContext("customer").firestore()), valid("customer")));
    await assertFails(api.setDoc(ref(env.authenticatedContext("old-admin").firestore()), valid("old-admin")));

    // The exact write the admin Templates tab makes is allowed, on create and on update.
    await assertSucceeds(api.setDoc(ref(admin), valid("admin")));
    await assertSucceeds(api.setDoc(ref(admin), valid("admin", { hidden: [], whatsapp: "" })));

    // Anyone, signed in or not, may read it (templates.html is public); nobody may list or delete.
    const visitor = env.unauthenticatedContext().firestore();
    const read = await assertSucceeds(api.getDoc(ref(visitor)));
    assert.deepEqual(read.data().hidden, []);
    await assertFails(api.getDocs(api.collection(visitor, "siteSettings")));
    await assertFails(api.getDocs(api.collection(admin, "siteSettings")));
    await assertFails(api.deleteDoc(ref(admin)));

    // Malformed writes from an admin are refused.
    await assertFails(api.setDoc(ref(admin), valid("admin", { extra: true })));
    await assertFails(api.setDoc(ref(admin), valid("admin", { hidden: "ember" })));
    await assertFails(api.setDoc(ref(admin), valid("admin", { hidden: Array.from({ length: 51 }, (_, i) => `t${i}`) })));
    await assertFails(api.setDoc(ref(admin), valid("admin", { whatsapp: "+971500000001" })));
    await assertFails(api.setDoc(ref(admin), valid("admin", { whatsapp: "1234567890123456" })));
    await assertFails(api.setDoc(ref(admin), valid("admin", { whatsapp: 971500000001 })));
    await assertFails(api.setDoc(ref(admin), valid("admin", { updatedBy: "someone-else" })));
    await assertFails(api.setDoc(ref(admin), valid("admin", { updatedAt: new Date("2020-01-01") })));
    const { whatsapp, ...noNumber } = valid("admin");
    await assertFails(api.setDoc(ref(admin), noNumber));

    // Other documents in siteSettings stay closed.
    await assertFails(api.setDoc(api.doc(admin, "siteSettings/other"), valid("admin")));
    await assertFails(api.getDoc(api.doc(visitor, "siteSettings/other")));
  } finally { await env.cleanup(); }
});
