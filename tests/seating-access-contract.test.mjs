import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildAuthRouteUrl } from "../firebase-service-scopes.js";

const root = new URL("../", import.meta.url);
const read = (name) => readFile(new URL(name, root), "utf8");

test("side links route through email/password sign-in and membership decides access", async () => {
  const [dashboard, login, side, scopes, rules] = await Promise.all([
    read("dashboard.js"), read("dashboard-login.js"), read("side.js"),
    read("firebase-service-scopes.js"), read("firestore.rules"),
  ]);
  assert.match(dashboard, /workspace: "side"/);
  assert.match(login, /signInWithEmailAndPassword\(services\.auth, email, password\)/);
  assert.match(login, /params\.get\("workspace"\) === "side"/);
  assert.match(side, /auth\.authStateReady\(\)/);
  assert.match(side, /"dashboardUsers", user\.uid/);
  assert.match(side, /permission\.allowedSide/);
  assert.doesNotMatch(side, /httpsCallable|signInWithCustomToken|setInterval/);
  assert.doesNotMatch(scopes, /seatingEditor|seating-only Firebase Auth/);
  assert.match(rules, /function seatingMemberMayReadSide\(weddingId, side\)/);
  assert.match(rules, /function seatingMemberMayEditSide\(weddingId, side\)/);
  assert.match(rules, /allowedSide == "all"/);
  assert.match(rules, /allowedSide in \["bride", "groom", "family"\]/);
  assert.match(rules, /category in \["celebration", "gender_reveal"\] \? side == "general" : side != "general"/);
  assert.equal(buildAuthRouteUrl("./dashboard.html", { weddingId: "event-42", side: "bride" }),
    "./dashboard.html?wedding=event-42&side=bride");
  assert.equal(buildAuthRouteUrl("./dashboard-login.html", { weddingId: "event-42", side: "bride", workspace: "side" }),
    "./dashboard-login.html?wedding=event-42&side=bride&workspace=side");
});

test("legacy editor-token URLs only route to account sign-in", async () => {
  const [dashboard, side] = await Promise.all([read("dashboard.js"), read("side.js")]);
  assert.match(dashboard, /params\.has\("token"\)/);
  assert.match(dashboard, /message: "account-sign-in-required"/);
  assert.match(side, /function renderLegacyEditorRoute\(\)/);
  assert.match(side, /This seating link has been retired/);
  assert.match(side, /Sign in with the account the event owner authorized/);
});

test("canonical seat and person records enforce side, person, and chair identity", async () => {
  const [rules, seating, side] = await Promise.all([
    read("firestore.rules"), read("seating-firestore.js"), read("side.js"),
  ]);
  assert.match(seating, /export async function mutateSeating\(/);
  for (const action of ["assign", "move", "swap", "unassign"]) assert.ok(seating.includes(`"${action}"`));
  assert.match(seating, /runTransaction/);
  assert.match(seating, /seatedPersonRef/);
  assert.match(seating, /destinationOccupancy\.data\(\)\.occupied === true/);
  assert.match(rules, /function validSeatAssignment\(/);
  assert.match(rules, /function validSeatedPerson\(/);
  assert.match(rules, /let guestAfter = getAfter\(guestPath\)\.data/);
  assert.match(rules, /data\.partyMemberIndex <= guestAfter\.additionalGuests/);
  assert.match(rules, /seatingMemberMayEditSide\(weddingId, resource\.data\.side\)/);
  assert.match(side, /mutateSeating\(/);
  assert.doesNotMatch(`${side}\n${seating}`, /httpsCallable|getFunctions|cloudfunctions\.net/);
});

test("family access remains read-only and seating-disabled events cannot be edited", async () => {
  const [side, seating, rules] = await Promise.all([read("side.js"), read("seating-firestore.js"), read("firestore.rules")]);
  assert.match(side, /permission\.canEditSeating === true && allowed !== "family"/);
  assert.match(seating, /allowedSide.*family/);
  assert.match(seating, /seatingEnabled === false/);
  assert.match(rules, /get\("seatingEnabled", true\) == true/);
});
