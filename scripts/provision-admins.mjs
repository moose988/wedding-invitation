#!/usr/bin/env node
// Operator tool: creates the two new platform administrators and, in a second
// phase, retires the old administrator account. A person runs this. It is never
// part of a build, deploy or test against production.
//
// Phase 1, preflight on the emulators (read-only, the default):
//   node scripts/provision-admins.mjs --email-shadi a@example.test --email-daya b@example.test
// Phase 1, create the accounts (production needs both --apply and --project):
//   ... --apply --project <firebase-project-id>
// Phase 2, retire the old account after both new administrators have signed in:
//   ... --retire-old-admin old@example.test --transfer-to a@example.test --apply --project <id>
// Phase 2, permanently delete it (asks for a typed confirmation):
//   ... --retire-old-admin old@example.test --transfer-to a@example.test --apply --project <id> --delete
//
// Against production a read-only preflight is refused too: the tool opens no
// connection unless both --apply and --project are given. Before any production
// write it lists what it found and asks for a typed confirmation.
//
// Passwords are printed once to the terminal. They are never written to disk or
// logged, and production refuses to print them anywhere but a real terminal.
import { randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { discoveryData } from "../account-access.js";

const WORDS = `able acid acre aged also amber angle apple arch area army aunt autumn away baby back badge bake ball band bank barn base basin bath beach bean bear beat bell belt bench berry best bike bird black blade blank blue board boat body bold bone book boot bottle bowl brain branch brave bread brick bridge bright broad brook brown brush build bulb bunch burst bush butter button cabin cable cake calm camel camp candle canoe canvas card care cargo carpet carrot cart castle catch cave cedar chain chair chalk charm chart chase cheese cherry chess chest chief circle city clay clean clear cliff climb clock cloth cloud clover coach coast coat cocoa coin cold color comet cook cool copper coral corn cotton couch count court cover craft crane cream creek crisp cross crown cubic curve daily dance dark dawn deep deer delta denim desert desk dial diary dish dock door dove draft dragon drawn dream dress drift drink drum dune eagle early earth easel east easy echo edge eight elbow elder ember empty engine equal even every extra fable face fair farm feast fence fern ferry field final finch fire first fish five flag flame flash fleet flint float floor flour flower fluid flute foam focus fog folder forest fork fort four fox frame fresh frost fruit full fun future galaxy game garden gate gentle giant gift ginger glass globe glove gold golf good grain grand grape grass gravel green grid grove guide guitar habit hair hall hammer hand happy harbor hard hat hawk hazel heart heat hedge hill hive holly home honey hope horse hotel hour house human hunt idea inch indigo ink inner iron island ivory jacket jade jar jelly jewel jolly juice jump jungle kettle key kind king kite kiwi knee knot lake lamp land lane large laser late lava lawn leaf lemon lens level light lilac lily lime line lion list little loaf lobby long lotus loud lucky lunar lunch magic magnet main maple marble march market meadow melon metal middle mild milk mill mint mirror model moon moss motor mount mouse music nail navy nest nice night noble north note novel oak oasis ocean olive onion open orange orbit orchid otter outer owl oyster paddle page paint palm panda paper park pasta path peach pearl pencil pepper piano picnic pilot pine pink pipe plain plane planet plant plate plaza plum polar pond pony pool poppy port pouch power prairie press prism proud puzzle quick quiet quilt rabbit radio rain ranch raven reef ribbon rice rich ring river road robin rock roof room root rope rose round royal ruby rule safe sage sail salt sand satin scale scarf school scout sea seed shade shell shelf shine ship shore silk silver simple sister six sky sleek slope small smile smooth snow soap sofa soft solar solid song south space spark spice spoon spring square stable stage stair star steam steel stem step stone storm story stove straw stream street strong sugar summer sun sunny swan sweet swift table tall teal tent thick thread three tiger timber tiny toast tomato tooth torch tower town track trail train tree trout true tulip tuna turtle twin umber union unit upper urban valley velvet vest violet vivid voice wagon walnut warm water wave west wheat wheel white wide willow wind window winter wise wood wool yard yellow yoga zebra zero zinc`.split(/\s+/);

const AWS_REMINDER = "REMINDER: update the AWS owner and admin UID lists (OwnerUids and AdminUids, OWNER_UIDS and ADMIN_UIDS) on every deployed photo bucket stack: remove the old UID, add the new UIDs.";
const MAX_WRITES_PER_BATCH = 450; // Firestore's limit is 500; one event's writes never split.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;

class Refusal extends Error {}

// Word-word-word-number from crypto randomness. Roughly 37 bits: easy to type and
// meant to be changed at first sign-in, not a long-term secret.
export function generatePassword(random = randomInt) {
  const pick = () => WORDS[random(WORDS.length)];
  const password = `${pick()}-${pick()}-${pick()}-${random(100, 1000)}`;
  // A rare combination of three very short words is drawn again.
  return password.length >= 16 ? password : generatePassword(random);
}

export const WORD_COUNT = WORDS.length;

export function parseCommandLine(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      "email-shadi": { type: "string" },
      "email-daya": { type: "string" },
      "retire-old-admin": { type: "string" },
      "transfer-to": { type: "string" },
      project: { type: "string" },
      apply: { type: "boolean", default: false },
      delete: { type: "boolean", default: false },
      "allow-existing-account": { type: "boolean", default: false },
    },
  });
  const normalized = (value) => value?.trim().toLowerCase();
  const options = {
    shadi: normalized(values["email-shadi"]),
    daya: normalized(values["email-daya"]),
    oldAdmin: normalized(values["retire-old-admin"]),
    transferTo: normalized(values["transfer-to"]),
    project: values.project?.trim(),
    apply: values.apply,
    delete: values.delete,
    allowExisting: values["allow-existing-account"],
  };
  if (!options.shadi || !options.daya) throw new Refusal("--email-shadi and --email-daya are both required.");
  for (const email of [options.shadi, options.daya, options.oldAdmin, options.transferTo]) {
    if (email && !EMAIL.test(email)) throw new Refusal(`Not an email address: ${email}`);
  }
  if (options.shadi === options.daya) throw new Refusal("The two administrators must have different email addresses.");
  if (options.oldAdmin && [options.shadi, options.daya].includes(options.oldAdmin)) throw new Refusal("The account being retired cannot be one of the new administrators.");
  if (options.oldAdmin && ![options.shadi, options.daya].includes(options.transferTo)) throw new Refusal("--retire-old-admin needs --transfer-to set to one of the two new administrator emails.");
  if (!options.oldAdmin && (options.transferTo || options.delete)) throw new Refusal("--transfer-to and --delete only apply with --retire-old-admin.");
  if (options.delete && !options.apply) throw new Refusal("--delete requires --apply.");
  return options;
}

// Decides where the tool may connect before anything is opened.
export function resolveTarget(options, env) {
  const firestoreHost = env.FIRESTORE_EMULATOR_HOST, authHost = env.FIREBASE_AUTH_EMULATOR_HOST;
  if (Boolean(firestoreHost) !== Boolean(authHost)) {
    throw new Refusal("Set both FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST, or neither. One alone would mix an emulator with production.");
  }
  if (firestoreHost) {
    if (!LOOPBACK.test(firestoreHost) || !LOOPBACK.test(authHost)) throw new Refusal("Emulator hosts must be loopback addresses.");
    const projectId = options.project || env.GCLOUD_PROJECT || "demo-wedding-security";
    if (!projectId.startsWith("demo-")) throw new Refusal("With emulators selected the project must start with demo-.");
    return { emulator: true, projectId };
  }
  if (!options.apply || !options.project) {
    throw new Refusal("Refusing production: this needs both --apply and --project. No connection was opened. For a read-only preflight, run against the emulators.");
  }
  return { emulator: false, projectId: options.project };
}

async function findUser(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  }
}

async function readAdmin(context, email) {
  const user = await findUser(context.auth, email);
  const record = user ? await context.db.doc(`platformAdmins/${user.uid}`).get() : null;
  return { email, user, record: record?.exists ? record.data() : null };
}

// Reads one line from the operator. Never used for a password.
async function confirm(context, prompt, expected) {
  if (!context.target.emulator && !process.stdin.isTTY) throw new Refusal("A typed confirmation needs a real terminal.");
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try {
    // Closed input must refuse: an unanswered question would otherwise let the
    // process end quietly with a success code.
    const answer = await new Promise((resolve) => {
      reader.once("close", () => resolve(""));
      reader.question(`${prompt}\nType exactly: ${expected}\n> `).then(resolve, () => resolve(""));
    });
    if (answer.trim() !== expected) throw new Refusal("Confirmation did not match. Nothing further was changed.");
  } finally {
    reader.close();
  }
}

async function provision(context, options) {
  const admins = await Promise.all([options.shadi, options.daya].map((email) => readAdmin(context, email)));
  const problems = [];
  for (const { email, user, record } of admins) {
    const state = !user ? "no account" : user.disabled ? "account disabled" : "account exists";
    const adminState = !record ? "no platformAdmins record" : record.enabled === true ? "enabled" : "record not enabled";
    console.log(`${email}: ${state}${user ? ` (uid ${user.uid})` : ""}, ${adminState}`);
    if (user?.disabled) problems.push(`${email} is disabled. Review it before granting access.`);
    if (record && record.enabled !== true) problems.push(`${email} has a platformAdmins record that is not enabled. Review it with the project owner.`);
    // Sign-up is open on Firebase projects, so anyone could have registered this
    // address first. Granting administrator rights to it must be a deliberate act.
    if (user && !record && !options.allowExisting) problems.push(`${email} already has an account this tool did not just create. Confirm who controls it, then re-run with --allow-existing-account. Its password stays unchanged.`);
  }
  if (problems.length) throw new Refusal(problems.join("\n"));
  if (!options.apply) {
    console.log("Preflight only. Nothing was written. Re-run with --apply to create accounts.");
    return;
  }
  const creating = admins.filter((admin) => !admin.user);
  if (creating.length && !context.target.emulator && !process.stdout.isTTY) {
    throw new Refusal("Output is not a terminal, so a password could end up in a file. Nothing was created. Run this directly in a terminal.");
  }
  const pending = admins.filter((admin) => !admin.user || !admin.record);
  if (!pending.length) {
    console.log("Both administrators are already provisioned. Nothing was changed.");
    return;
  }
  if (!context.target.emulator) {
    await confirm(context, `About to change ${pending.map((admin) => admin.email).join(", ")} in project ${context.target.projectId}.`, context.target.projectId);
  }
  for (const admin of pending) {
    let uid = admin.user?.uid;
    if (!uid) {
      const password = generatePassword();
      uid = (await context.auth.createUser({ email: admin.email, password })).uid;
      // Printed before the next write, so a failure below cannot lose it.
      process.stdout.write(`\n  ${admin.email}\n  uid:      ${uid}\n  password: ${password}\n  Shown once. Hand it over privately; change it at first sign-in.\n\n`);
    }
    await context.db.doc(`platformAdmins/${uid}`).create({ enabled: true, email: admin.email, createdAt: FieldValue.serverTimestamp() });
    console.log(`${admin.email}: platform administrator enabled.`);
  }
  console.log("Clear this terminal's scrollback once the passwords are handed over.");
  const final = await Promise.all([options.shadi, options.daya].map((email) => readAdmin(context, email)));
  console.log(`New administrator UIDs for the AWS owner and admin UID lists: ${final.map((admin) => admin.user.uid).join(",")}`);
}

async function inventory(context, oldUid) {
  const { db } = context;
  const [owned, memberships, cards] = await Promise.all([
    db.collection("weddings").where("ownerUserId", "==", oldUid).get(),
    db.collectionGroup("dashboardUsers").where("userId", "==", oldUid).get(),
    db.collection(`users/${oldUid}/weddingAccess`).get(),
  ]);
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { id, event: null, membership: null, card: null, owned: false });
    return rows.get(id);
  };
  for (const doc of owned.docs) Object.assign(row(doc.id), { event: doc.data(), owned: true });
  for (const doc of memberships.docs) {
    // Only weddings/{id}/dashboardUsers/{uid} is a membership.
    if (doc.ref.parent.parent?.parent.id === "weddings" && doc.id === oldUid) row(doc.ref.parent.parent.id).membership = doc.data();
  }
  for (const doc of cards.docs) row(doc.id).card = doc.data();
  // An owner may lack a userId-indexed membership; read each event's direct records too.
  await Promise.all([...rows.values()].map(async (entry) => {
    if (!entry.event) {
      const snapshot = await db.doc(`weddings/${entry.id}`).get();
      entry.event = snapshot.exists ? snapshot.data() : null;
    }
    if (!entry.membership && entry.event) {
      const snapshot = await db.doc(`weddings/${entry.id}/dashboardUsers/${oldUid}`).get();
      entry.membership = snapshot.exists ? snapshot.data() : null;
    }
  }));
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function describeInventory(rows) {
  if (!rows.length) {
    console.log("No events, memberships or discovery cards reference the old account.");
    return;
  }
  console.log(`${rows.length} event record(s) reference the old account:`);
  for (const { id, event, owned, membership, card } of rows) {
    const flags = [owned ? "owner" : "", membership ? `member(${membership.role || "no role"})` : "", card ? "card" : "", !event ? "EVENT MISSING" : "", event?.deleting ? "deleting" : "", event?.isDemo ? "demo" : ""].filter(Boolean);
    console.log(`  ${id}  "${String(event?.eventTitle || card?.eventTitle || "").slice(0, 60)}"  ${flags.join(", ")}`);
  }
}

// One event's writes, always committed together.
export function transferWrites(entry, oldUid, newUser, serverTime) {
  const { id, event, owned, membership, card } = entry;
  const newEmail = newUser.email.toLowerCase();
  const paths = {
    event: `weddings/${id}`,
    oldMember: `weddings/${id}/dashboardUsers/${oldUid}`,
    newMember: `weddings/${id}/dashboardUsers/${newUser.uid}`,
    oldCard: `users/${oldUid}/weddingAccess/${id}`,
    newCard: `users/${newUser.uid}/weddingAccess/${id}`,
  };
  const writes = [];
  if (card) writes.push({ type: "delete", path: paths.oldCard });
  if (membership) writes.push({ type: "delete", path: paths.oldMember });
  // A card or membership under a removed event is only cleared, never moved.
  if (!event || (!owned && !membership)) return writes;
  if (owned) {
    writes.push({ type: "update", path: paths.event, data: { ownerUserId: newUser.uid } });
    writes.push({
      type: "set",
      path: paths.newMember,
      data: {
        ...(membership || { canViewDashboard: true, canEditGuests: true, canEditSeating: true, canCheckIn: true, canManageUsers: true, role: "owner", createdAt: serverTime }),
        userId: newUser.uid, email: newEmail, updatedAt: serverTime,
      },
    });
  } else {
    // A membership the old account held on someone else's event. Existing rights
    // of the new administrator are kept: merge never narrows, and the old fields
    // are only a default for a record that is not there yet.
    writes.push({ type: "setIfAbsent", path: paths.newMember, data: { ...membership, userId: newUser.uid, email: newEmail, updatedAt: serverTime } });
  }
  const eventAfter = owned ? { ...event, ownerUserId: newUser.uid } : event;
  writes.push({
    type: "set",
    path: paths.newCard,
    data: { ...(card || {}), ...discoveryData(id, eventAfter), updatedAt: serverTime },
  });
  return writes;
}

async function commitTransfers(context, rows, oldUid, newUser) {
  const { db } = context;
  const serverTime = FieldValue.serverTimestamp();
  const planned = rows.map((entry) => transferWrites(entry, oldUid, newUser, serverTime)).filter((writes) => writes.length);
  // An existing membership of the new administrator on a non-owned event is kept.
  const existingMembers = new Set();
  for (const writes of planned) {
    for (const write of writes) {
      if (write.type === "setIfAbsent" && (await db.doc(write.path).get()).exists) existingMembers.add(write.path);
    }
  }
  let batch = db.batch(), count = 0, committedBatches = 0;
  const flush = async () => {
    if (!count) return;
    await batch.commit();
    committedBatches += 1;
    batch = db.batch();
    count = 0;
  };
  for (const writes of planned) {
    if (count + writes.length > MAX_WRITES_PER_BATCH) await flush();
    for (const write of writes) {
      const ref = db.doc(write.path);
      if (write.type === "delete") batch.delete(ref);
      else if (write.type === "update") batch.update(ref, write.data);
      else if (write.type === "set") batch.set(ref, write.data);
      else if (!existingMembers.has(write.path)) batch.set(ref, write.data);
    }
    count += writes.length;
  }
  await flush();
  console.log(`Transferred in ${committedBatches} atomic batch(es); one event's records are never split.`);
}

async function retire(context, options) {
  const { auth, db, target } = context;
  const admins = await Promise.all([options.shadi, options.daya].map((email) => readAdmin(context, email)));
  const notReady = admins.filter(({ user, record }) => !user || user.disabled || record?.enabled !== true);
  if (notReady.length) {
    throw new Refusal(`Refusing to retire the old account. Not ready: ${notReady.map((admin) => admin.email).join(", ")}. Both new administrators must exist, be active and be enabled in platformAdmins.`);
  }
  const oldUser = await findUser(auth, options.oldAdmin);
  if (!oldUser) throw new Refusal(`No account found for ${options.oldAdmin}.`);
  const newAdmin = admins.find((admin) => admin.email === options.transferTo);
  console.log(`Old account: ${options.oldAdmin} (uid ${oldUser.uid}${oldUser.disabled ? ", already disabled" : ""})`);
  console.log(`Transfer to: ${newAdmin.email} (uid ${newAdmin.user.uid})`);
  const rows = await inventory(context, oldUser.uid);
  describeInventory(rows);
  const reminder = () => console.log(`${AWS_REMINDER}\n  Old UID: ${oldUser.uid}\n  New UIDs: ${admins.map((admin) => admin.user.uid).join(",")}`);
  if (!options.apply) {
    console.log("Preflight only. Nothing was written. Re-run with --apply to transfer and disable.");
    reminder();
    return;
  }
  if (!target.emulator) {
    await confirm(context, `About to transfer ${rows.length} event record(s) and disable ${options.oldAdmin} in project ${target.projectId}.`, target.projectId);
  }
  if (rows.length) await commitTransfers(context, rows, oldUser.uid, newAdmin.user);
  const remaining = await inventory(context, oldUser.uid);
  if (remaining.length) {
    describeInventory(remaining);
    throw new Refusal("Records still reference the old account, possibly created during this run. The account was NOT disabled. Re-run this command.");
  }
  // The record closes the administrator path immediately. Disabling and revoking
  // stops new tokens; a token already issued expires within the hour.
  const oldRecord = db.doc(`platformAdmins/${oldUser.uid}`);
  if ((await oldRecord.get()).exists) await oldRecord.update({ enabled: false, retiredAt: FieldValue.serverTimestamp() });
  await auth.updateUser(oldUser.uid, { disabled: true });
  await auth.revokeRefreshTokens(oldUser.uid);
  console.log(`${options.oldAdmin} is disabled and its platform administrator record is off.`);
  if (options.delete) {
    await confirm(context, `Permanently deleting ${options.oldAdmin}. This cannot be undone.`, `DELETE ${options.oldAdmin}`);
    await auth.deleteUser(oldUser.uid);
    await oldRecord.delete();
    console.log(`${options.oldAdmin} was permanently deleted.`);
  } else {
    console.log("The account still exists, disabled. Deletion needs a further --delete and a typed confirmation.");
  }
  reminder();
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseCommandLine(argv);
  const target = resolveTarget(options, env);
  console.log(`Target: ${target.emulator ? "emulators" : "PRODUCTION"}, project ${target.projectId}, ${options.apply ? "apply" : "preflight (read-only)"}`);
  const app = initializeApp(target.emulator ? { projectId: target.projectId } : { projectId: target.projectId, credential: applicationDefault() }, `provision-admins-${Date.now()}`);
  const context = { target, auth: getAuth(app), db: getFirestore(app) };
  try {
    await (options.oldAdmin ? retire(context, options) : provision(context, options));
  } finally {
    await deleteApp(app);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Error text only: no stack, request body or credential detail is printed.
    console.error(error instanceof Refusal ? error.message : `Stopped: ${error.code || ""} ${error.message}`.trim());
    process.exitCode = 1;
  });
}
