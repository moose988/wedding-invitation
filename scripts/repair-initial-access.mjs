// Deliberately not a browser bootstrap. Requires the developer's authenticated
// Firebase CLI IAM session AND authentication of both specifically authorized
// existing test accounts. Defaults to a read-only preflight.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { initializeApp, deleteApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { customerMembership, discoveryData } from "../account-access.js";
const require = createRequire(import.meta.url);
if (!process.env.FIREBASE_CLI_LIB || !process.env.ACCESS_REPAIR_CREDENTIALS_FILE) throw new Error("Set the Firebase CLI library path and the authorized request file path. Never put passwords in command arguments.");
const { configstore } = require(`${process.env.FIREBASE_CLI_LIB}/configstore.js`);
const { getAccessToken } = require(`${process.env.FIREBASE_CLI_LIB}/auth.js`);
const iam = await getAccessToken(configstore.get("tokens").refresh_token, []);
const headers = { Authorization: `Bearer ${iam.access_token}`, "Content-Type": "application/json" };
const projectId = "weddinginvitaion-b4f36", weddingId = "luxury-wedding-demo";
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const configSource = await readFile(new URL("../firebase-config.js", import.meta.url), "utf8");
const apiKey = configSource.match(/apiKey: "(AIza[^"]+)"/)[1];
const request = await readFile(process.env.ACCESS_REPAIR_CREDENTIALS_FILE, "utf8");
const password = request.match(/Password for these two existing accounts: (\S+)/)?.[1];
if (!password) throw new Error("The authorized request file does not contain the supplied test credentials.");
const users = [];
for (const email of ["test@gmail.com", "girl@gmail.com"]) {
  const app = initializeApp({ apiKey, projectId }, `trusted-setup-${email}`);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    if (user.email?.toLowerCase() !== email) throw new Error("Authenticated email mismatch.");
    users.push({ uid: user.uid, email, emailVerified: user.emailVerified });
  } finally { await signOut(auth); await deleteApp(app); }
}
function decode(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue) return new Date(value.timestampValue);
  if (value.arrayValue) return (value.arrayValue.values || []).map(decode);
  if (value.mapValue) return decodeFields(value.mapValue.fields || {});
  return null;
}
const decodeFields = (fields) => Object.fromEntries(Object.entries(fields || {}).map(([key, value]) => [key, decode(value)]));
async function get(path, allowMissing = false) {
  const response = await fetch(`${base}/${path}`, { headers });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Trusted read failed (${response.status}) for ${path}`);
  return response.json();
}
async function rows(name) {
  const result = []; let next = "";
  do {
    const page = await get(`weddings/${weddingId}/${name}?pageSize=300${next ? `&pageToken=${encodeURIComponent(next)}` : ""}`);
    result.push(...(page.documents || []).map((doc) => ({ id: doc.name.split("/").at(-1), ...decodeFields(doc.fields) }))); next = page.nextPageToken || "";
  } while (next);
  return result;
}
const [admin, customer] = users;
const eventDoc = await get(`weddings/${weddingId}`), event = decodeFields(eventDoc.fields);
if (event.ownerUserId !== admin.uid) throw new Error("The event already has a different owner. This setup never replaces an owner.");
const [tables, seats, people, occupancy] = await Promise.all([rows("tables"), rows("seatAssignments"), rows("seatedPeople"), rows("seatOccupancy")]);
const canonicalSeatsConsistent = seats.every((seat) => {
  const table = tables.find((table) => table.id === seat.tableId);
  const person = people.find((person) => person.id === `${seat.guestId}~${seat.personKey}`);
  const marker = occupancy.find((marker) => marker.id === `${seat.tableId}~${seat.chairId}`);
  return table?.chairs?.[seat.seatNumber - 1]?.id === seat.chairId
    && table.chairs.some((chair) => chair.id === seat.chairId && Number(chair.seatNumber) === seat.seatNumber)
    && person?.tableId === seat.tableId && person?.chairId === seat.chairId && marker?.occupied === true;
}) && people.length === seats.length && new Set(seats.map((seat) => `${seat.guestId}~${seat.personKey}`)).size === seats.length;
const legacyAssignedChairs = tables.flatMap((table) => table.chairs || []).filter((chair) => chair.assignment?.guestId || chair.guestId).length;
if (!canonicalSeatsConsistent || legacyAssignedChairs) throw new Error("Canonical seating is incomplete. No authorization or seating changes were made.");
console.log(JSON.stringify({ mode: process.argv.includes("--apply") ? "apply" : "preflight", admin, customer, canonicalSeatsConsistent, seatCount: seats.length, legacyAssignedChairs, seatingSchemaVersion: event.seatingSchemaVersion || null }));
if (!process.argv.includes("--apply")) process.exit(0);
function encode(value) {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (value === null) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (typeof value === "object") return { mapValue: { fields: fields(value) } };
  return { stringValue: value };
}
const fields = (data) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
const now = new Date(), writes = [];
function set(path, data, extra = {}) { writes.push({ update: { name: `${base.replace("https://firestore.googleapis.com/v1/", "")}/${path}`, fields: fields(data) }, ...extra }); }
const adminRecord = await get(`platformAdmins/${admin.uid}`, true);
if (!adminRecord) set(`platformAdmins/${admin.uid}`, { enabled: true }, { currentDocument: { exists: false } });
else if (decodeFields(adminRecord.fields).enabled !== true) throw new Error("The administrator record exists but is disabled. Review it with the project owner.");
const oldMembership = await get(`weddings/${weddingId}/dashboardUsers/${customer.uid}`, true);
set(`weddings/${weddingId}/dashboardUsers/${customer.uid}`, { ...customerMembership(customer.uid, customer.email, now), createdAt: decodeFields(oldMembership?.fields).createdAt || now });
set(`customerDirectory/${customer.uid}`, { userId: customer.uid, email: customer.email, updatedAt: now });
for (const user of users) set(`users/${user.uid}/weddingAccess/${weddingId}`, { ...discoveryData(weddingId, event), updatedAt: now });
// Only finalize the missing internal marker after checking every existing
// canonical seat, person binding and occupied marker. No guest, table, chair,
// assignment, token, ownership or editable event field is written.
if (event.seatingSchemaVersion !== 2) {
  if (!process.argv.includes("--finalize-seating")) throw new Error("Canonical seating is consistent but needs its internal schema marker. Re-run with --finalize-seating to finalize metadata only.");
  set(`weddings/${weddingId}`, { seatingSchemaVersion: 2 }, { updateMask: { fieldPaths: ["seatingSchemaVersion"] }, currentDocument: { updateTime: eventDoc.updateTime } });
}
const response = await fetch(`${base}:commit`, { method: "POST", headers, body: JSON.stringify({ writes }) });
if (!response.ok) throw new Error(`Trusted setup commit failed (${response.status}). No partial Firestore writes were committed.`);
console.log("Trusted administrator and customer access records committed atomically. Auth accounts and existing event data retained.");
