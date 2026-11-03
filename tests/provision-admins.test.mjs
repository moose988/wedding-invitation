import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { generatePassword, parseCommandLine, resolveTarget, transferWrites, WORD_COUNT } from "../scripts/provision-admins.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/provision-admins.mjs", import.meta.url));
const EMULATORS = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST);
const PROJECT = process.env.GCLOUD_PROJECT || "demo-wedding-security";
const SHADI = "shadi@example.test", DAYA = "daya@example.test", OLD = "old-admin@example.test";
const NAMES = ["--email-shadi", SHADI, "--email-daya", DAYA];

function run(args, { env = process.env, input = "" } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

const productionEnv = () => {
  const env = { ...process.env };
  delete env.FIRESTORE_EMULATOR_HOST;
  delete env.FIREBASE_AUTH_EMULATOR_HOST;
  return env;
};

test("generated passwords are easy to type, long enough and do not repeat", () => {
  assert.ok(WORD_COUNT >= 500, "word list too small");
  const seen = new Set();
  for (let index = 0; index < 5000; index += 1) {
    const password = generatePassword();
    assert.match(password, /^[a-z]+-[a-z]+-[a-z]+-[1-9][0-9]{2}$/);
    assert.ok(password.length >= 16, password);
    seen.add(password);
  }
  assert.equal(seen.size, 5000);
});

test("the command line refuses incomplete or contradictory requests", () => {
  for (const args of [[], ["--email-shadi", SHADI], [...NAMES.slice(0, 2), "--email-daya", SHADI], ["--email-shadi", "not-an-email", "--email-daya", DAYA],
    [...NAMES, "--retire-old-admin", OLD], [...NAMES, "--retire-old-admin", SHADI, "--transfer-to", DAYA], [...NAMES, "--retire-old-admin", OLD, "--transfer-to", "other@example.test"],
    [...NAMES, "--delete", "--apply"], [...NAMES, "--retire-old-admin", OLD, "--transfer-to", SHADI, "--delete"]]) {
    assert.throws(() => parseCommandLine(args), undefined, args.join(" "));
  }
  assert.throws(() => parseCommandLine([...NAMES, "--password", "x"]), /password/i);
});

test("target resolution opens production only with both --apply and --project", () => {
  const options = (extra) => parseCommandLine([...NAMES, ...extra]);
  assert.throws(() => resolveTarget(options([]), {}), /Refusing production/);
  assert.throws(() => resolveTarget(options(["--apply"]), {}), /Refusing production/);
  assert.throws(() => resolveTarget(options(["--project", "real-project"]), {}), /Refusing production/);
  assert.deepEqual(resolveTarget(options(["--apply", "--project", "real-project"]), {}), { emulator: false, projectId: "real-project" });
  const loopback = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" };
  assert.deepEqual(resolveTarget(options([]), loopback), { emulator: true, projectId: "demo-wedding-security" });
  assert.throws(() => resolveTarget(options([]), { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }), /both/);
  assert.throws(() => resolveTarget(options([]), { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }), /both/);
  assert.throws(() => resolveTarget(options([]), { FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }), /loopback/);
  assert.throws(() => resolveTarget(options(["--apply", "--project", "real-project"]), loopback), /demo-/);
});

test("without emulators the process refuses before opening a connection", async () => {
  for (const extra of [[], ["--apply"], ["--project", "real-project"]]) {
    const result = await run([...NAMES, ...extra], { env: productionEnv() });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Refusing production/);
    assert.doesNotMatch(result.stdout, /Target:/);
  }
});

test("an orphaned card or membership is cleared and never moved", () => {
  const writes = transferWrites({ id: "gone", event: null, owned: false, membership: { role: "owner" }, card: { weddingId: "gone" } }, "old", { uid: "new", email: SHADI }, "NOW");
  assert.deepEqual(writes.map(({ type, path }) => [type, path]), [["delete", "users/old/weddingAccess/gone"], ["delete", "weddings/gone/dashboardUsers/old"]]);
});

async function resetEmulators() {
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
}

async function signIn(email, password) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  return { ok: response.ok, body: await response.json() };
}

const passwordsIn = (text) => [...text.matchAll(/password: (\S+)/g)].map((match) => match[1]);

test("the tool provisions and retires administrators on the emulators", { skip: !EMULATORS, timeout: 120000 }, async () => {
  await resetEmulators();
  const app = initializeApp({ projectId: PROJECT }, "provision-test");
  const auth = getAuth(app), db = getFirestore(app);
  const exists = async (path) => (await db.doc(path).get()).exists;
  try {
    // Preflight reads only.
    const preflight = await run(NAMES);
    assert.equal(preflight.code, 0, preflight.stderr);
    assert.match(preflight.stdout, /Preflight only/);
    assert.equal(passwordsIn(preflight.stdout).length, 0);
    assert.equal((await auth.listUsers()).users.length, 0);

    // Apply creates both accounts and prints each password exactly once.
    const applied = await run([...NAMES, "--apply"]);
    assert.equal(applied.code, 0, applied.stderr);
    const passwords = passwordsIn(applied.stdout);
    assert.equal(passwords.length, 2);
    assert.notEqual(passwords[0], passwords[1]);
    for (const password of passwords) {
      assert.match(password, /^[a-z]+-[a-z]+-[a-z]+-\d{3}$/);
      assert.equal(applied.stdout.split(password).length, 2);
      assert.equal(applied.stderr.includes(password), false);
    }
    assert.equal((await signIn(SHADI, passwords[0])).ok, true);
    assert.equal((await signIn(DAYA, passwords[1])).ok, true);
    const shadi = await auth.getUserByEmail(SHADI), daya = await auth.getUserByEmail(DAYA);
    assert.equal((await db.doc(`platformAdmins/${shadi.uid}`).get()).data().enabled, true);
    assert.equal((await db.doc(`platformAdmins/${daya.uid}`).get()).data().enabled, true);

    // A second run changes nothing, and never rotates a password.
    const again = await run([...NAMES, "--apply"]);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(passwordsIn(again.stdout).length, 0);
    assert.equal((await signIn(SHADI, passwords[0])).ok, true);

    // Someone else's pre-registered account needs a deliberate flag.
    const squatted = await auth.createUser({ email: "squatted@example.test", password: "someone-elses-secret" });
    const other = ["--email-shadi", "squatted@example.test", "--email-daya", DAYA];
    for (const args of [other, [...other, "--apply"]]) {
      const result = await run(args);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /allow-existing-account/);
    }
    assert.equal(await exists(`platformAdmins/${squatted.uid}`), false);
    const allowed = await run([...other, "--apply", "--allow-existing-account"]);
    assert.equal(allowed.code, 0, allowed.stderr);
    assert.equal(passwordsIn(allowed.stdout).length, 0);
    assert.equal(await exists(`platformAdmins/${squatted.uid}`), true);
    assert.equal((await signIn("squatted@example.test", "someone-elses-secret")).ok, true);

    // A record that was deliberately turned off is not silently turned back on.
    const off = await auth.createUser({ email: "off@example.test", password: "off-account-secret" });
    await db.doc(`platformAdmins/${off.uid}`).set({ enabled: false });
    const refused = await run(["--email-shadi", "off@example.test", "--email-daya", DAYA, "--apply", "--allow-existing-account"]);
    assert.equal(refused.code, 1);
    assert.equal((await db.doc(`platformAdmins/${off.uid}`).get()).data().enabled, false);

    // Old administrator: owns 130 events (more than one batch), a deleting event
    // and a demo; is a member of someone else's event; has stale records.
    const old = await auth.createUser({ email: OLD, password: "old-admin-secret" });
    await db.doc(`platformAdmins/${old.uid}`).set({ enabled: true });
    const ownerMembership = { userId: old.uid, email: OLD, role: "owner", canViewDashboard: true, canEditGuests: true, canEditSeating: true, canCheckIn: true, canManageUsers: true };
    const writer = db.bulkWriter();
    for (let index = 0; index < 130; index += 1) {
      const id = `event-${String(index).padStart(3, "0")}`;
      writer.set(db.doc(`weddings/${id}`), { ownerUserId: old.uid, eventTitle: `Event ${index}`, eventCategory: "celebration", status: "active" });
      writer.set(db.doc(`weddings/${id}/dashboardUsers/${old.uid}`), ownerMembership);
      writer.set(db.doc(`users/${old.uid}/weddingAccess/${id}`), { weddingId: id, ownerUserId: old.uid, eventTitle: `Event ${index}` });
      writer.set(db.doc(`weddings/${id}/dashboardUsers/customer`), { userId: "customer", email: "customer@example.test", role: "customer" });
      writer.set(db.doc(`weddings/${id}/guests/g`), { fullName: "Untouched Guest" });
    }
    writer.set(db.doc("weddings/no-membership"), { ownerUserId: old.uid, eventTitle: "Owner without membership", status: "draft" });
    writer.set(db.doc("weddings/deleting"), { ownerUserId: old.uid, eventTitle: "Deleting", deleting: true });
    writer.set(db.doc(`weddings/deleting/dashboardUsers/${old.uid}`), ownerMembership);
    writer.set(db.doc("weddings/demo"), { ownerUserId: old.uid, eventTitle: "Demo", isDemo: true, demoExpiresAt: new Date(Date.now() + 3_600_000) });
    writer.set(db.doc(`weddings/demo/dashboardUsers/${old.uid}`), ownerMembership);
    writer.set(db.doc("weddings/shared"), { ownerUserId: daya.uid, eventTitle: "Member only" });
    writer.set(db.doc(`weddings/shared/dashboardUsers/${old.uid}`), { ...ownerMembership, role: "admin" });
    writer.set(db.doc(`users/${old.uid}/weddingAccess/shared`), { weddingId: "shared", eventTitle: "Member only" });
    writer.set(db.doc("weddings/kept"), { ownerUserId: daya.uid, eventTitle: "New admin keeps rights" });
    writer.set(db.doc(`weddings/kept/dashboardUsers/${old.uid}`), { ...ownerMembership, role: "seating", canManageUsers: false, seatingOnly: true });
    writer.set(db.doc(`weddings/kept/dashboardUsers/${shadi.uid}`), { userId: shadi.uid, email: SHADI, role: "admin", canManageUsers: true });
    writer.set(db.doc(`weddings/removed/dashboardUsers/${old.uid}`), ownerMembership);
    writer.set(db.doc(`users/${old.uid}/weddingAccess/removed`), { weddingId: "removed" });
    writer.set(db.doc(`users/${old.uid}/weddingAccess/stale`), { weddingId: "stale" });
    writer.set(db.doc("weddings/stale"), { ownerUserId: daya.uid, eventTitle: "Not the old account's" });
    writer.set(db.doc("weddings/unrelated"), { ownerUserId: daya.uid, eventTitle: "Unrelated" });
    writer.set(db.doc("weddings/unrelated/dashboardUsers/customer"), { userId: "customer", email: "customer@example.test", role: "customer" });
    await writer.close();
    const retireArgs = [...NAMES, "--retire-old-admin", OLD, "--transfer-to", SHADI];

    // Refused until both new administrators exist and are enabled.
    await db.doc(`platformAdmins/${daya.uid}`).update({ enabled: false });
    const notEnabled = await run([...retireArgs, "--apply"]);
    assert.equal(notEnabled.code, 1);
    assert.match(notEnabled.stderr, /Not ready: daya@example.test/);
    await db.doc(`platformAdmins/${daya.uid}`).update({ enabled: true });
    await auth.updateUser(daya.uid, { disabled: true });
    assert.equal((await run([...retireArgs, "--apply"])).code, 1);
    await auth.updateUser(daya.uid, { disabled: false });
    const missing = await run(["--email-shadi", SHADI, "--email-daya", "nobody@example.test", "--retire-old-admin", OLD, "--transfer-to", SHADI, "--apply"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /nobody@example.test/);
    assert.equal((await db.doc("weddings/event-000").get()).data().ownerUserId, old.uid);
    assert.equal((await auth.getUser(old.uid)).disabled, false);

    // Retire preflight lists everything and changes nothing.
    const listing = await run(retireArgs);
    assert.equal(listing.code, 0, listing.stderr);
    for (const id of ["event-000", "event-129", "no-membership", "deleting", "demo", "shared", "kept", "removed", "stale"]) assert.match(listing.stdout, new RegExp(`\\b${id}\\b`));
    assert.doesNotMatch(listing.stdout, /unrelated/);
    assert.match(listing.stdout, /AWS owner and admin UID lists/);
    assert.equal((await db.doc("weddings/event-000").get()).data().ownerUserId, old.uid);
    assert.equal((await auth.getUser(old.uid)).disabled, false);

    // Apply transfers in atomic batches, then disables without deleting.
    const transferred = await run([...retireArgs, "--apply"]);
    assert.equal(transferred.code, 0, transferred.stderr);
    assert.match(transferred.stdout, /in 2 atomic batch/);
    assert.match(transferred.stdout, /AWS owner and admin UID lists/);
    for (const id of ["event-000", "event-129", "deleting", "demo", "no-membership"]) {
      assert.equal((await db.doc(`weddings/${id}`).get()).data().ownerUserId, shadi.uid, id);
      const membership = (await db.doc(`weddings/${id}/dashboardUsers/${shadi.uid}`).get()).data();
      assert.equal(membership.userId, shadi.uid);
      assert.equal(membership.email, SHADI);
      assert.equal(membership.role, "owner");
      assert.equal(membership.canManageUsers, true);
      assert.equal(await exists(`weddings/${id}/dashboardUsers/${old.uid}`), false, id);
      assert.equal(await exists(`users/${old.uid}/weddingAccess/${id}`), false, id);
      const card = (await db.doc(`users/${shadi.uid}/weddingAccess/${id}`).get()).data();
      assert.equal(card.weddingId, id);
      assert.equal(card.ownerUserId, shadi.uid);
    }
    assert.equal((await db.doc("weddings/deleting").get()).data().deleting, true);
    assert.equal((await db.doc("weddings/demo").get()).data().isDemo, true);
    // A shared event moves the membership but not the ownership.
    assert.equal((await db.doc("weddings/shared").get()).data().ownerUserId, daya.uid);
    assert.equal((await db.doc(`weddings/shared/dashboardUsers/${shadi.uid}`).get()).data().role, "admin");
    assert.equal((await db.doc(`users/${shadi.uid}/weddingAccess/shared`).get()).data().ownerUserId, daya.uid);
    // A new administrator's existing rights are not narrowed by the old record.
    assert.equal((await db.doc(`weddings/kept/dashboardUsers/${shadi.uid}`).get()).data().role, "admin");
    assert.equal((await db.doc(`weddings/kept/dashboardUsers/${shadi.uid}`).get()).data().seatingOnly, undefined);
    assert.equal(await exists(`weddings/kept/dashboardUsers/${old.uid}`), false);
    // Orphans and stale cards are cleared, not moved.
    assert.equal(await exists(`weddings/removed/dashboardUsers/${old.uid}`), false);
    assert.equal(await exists("weddings/removed"), false);
    assert.equal(await exists(`users/${old.uid}/weddingAccess/stale`), false);
    assert.equal(await exists(`users/${shadi.uid}/weddingAccess/stale`), false);
    assert.equal(await exists(`users/${shadi.uid}/weddingAccess/removed`), false);
    // Everything else on the event is untouched, including other events entirely.
    assert.equal((await db.doc("weddings/event-000/dashboardUsers/customer").get()).data().role, "customer");
    assert.equal((await db.doc("weddings/event-000/guests/g").get()).data().fullName, "Untouched Guest");
    assert.equal((await db.doc("weddings/unrelated").get()).data().ownerUserId, daya.uid);
    assert.equal(await exists(`weddings/unrelated/dashboardUsers/${shadi.uid}`), false);
    // The account is off but still there, and its administrator record is off.
    const disabled = await auth.getUser(old.uid);
    assert.equal(disabled.disabled, true);
    assert.ok(disabled.tokensValidAfterTime);
    assert.equal((await db.doc(`platformAdmins/${old.uid}`).get()).data().enabled, false);
    assert.equal((await signIn(OLD, "old-admin-secret")).ok, false);

    // Re-running is safe.
    const rerun = await run([...retireArgs, "--apply"]);
    assert.equal(rerun.code, 0, rerun.stderr);
    assert.match(rerun.stdout, /No events, memberships or discovery cards/);

    // Deletion needs the flag and the exact words.
    const wrong = await run([...retireArgs, "--apply", "--delete"], { input: "yes\n" });
    assert.equal(wrong.code, 1);
    assert.match(wrong.stderr, /Confirmation did not match/);
    assert.equal((await auth.getUser(old.uid)).uid, old.uid);
    const silent = await run([...retireArgs, "--apply", "--delete"]);
    assert.equal(silent.code, 1);
    assert.equal((await auth.getUser(old.uid)).uid, old.uid);
    const deleted = await run([...retireArgs, "--apply", "--delete"], { input: `DELETE ${OLD}\n` });
    assert.equal(deleted.code, 0, deleted.stderr);
    await assert.rejects(auth.getUser(old.uid), { code: "auth/user-not-found" });
    assert.equal(await exists(`platformAdmins/${old.uid}`), false);
    assert.equal(await exists(`platformAdmins/${shadi.uid}`), true);
    assert.equal((await run(retireArgs)).code, 1);
  } finally {
    await deleteApp(app);
    await resetEmulators();
  }
});
