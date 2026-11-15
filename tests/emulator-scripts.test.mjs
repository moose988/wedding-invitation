// The emulator test files share one emulator and several of them wipe it
// (clearFirestore, or deleting every Auth account). Run together in parallel
// they break each other, so the scripts that run them must go one file at a
// time, and must not depend on a globally installed firebase command.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const scripts = pkg.scripts;
const emulatorScripts = Object.entries(scripts).filter(([, value]) => value.includes("emulators:exec"));

test("emulator scripts use a pinned firebase-tools, not a global firebase command", () => {
  assert.ok(emulatorScripts.length >= 5);
  for (const [name, value] of emulatorScripts) {
    assert.match(value, /^npx --yes firebase-tools@15 emulators:exec /, `${name} should run firebase-tools through npx`);
  }
});

test("emulator scripts run test files one at a time", () => {
  for (const [name, value] of emulatorScripts) {
    for (const run of value.match(/node --test[^&"]*/g) || []) {
      assert.match(run, /--test-concurrency=1/, `${name}: ${run}`);
    }
  }
});

test("test:emulator runs every test file, then the seeded customer test", async () => {
  const value = scripts["test:emulator"];
  assert.ok(value, "test:emulator should exist");
  assert.match(value, /--only auth,firestore /);
  assert.match(value, /node --test --test-concurrency=1 &&/);
  assert.match(value, /node scripts\/seed-local-access\.mjs &&/);
  assert.match(value, /CUSTOMER_FUNCTIONS_EMULATOR_TEST=1 node --test --test-concurrency=1 tests\/customer-management-emulator\.test\.mjs/);
});

test("test:security still covers every Firestore rules test file", async () => {
  const files = (await readdir(new URL("./", import.meta.url))).filter((file) => file.endsWith("-firestore.test.mjs"));
  for (const file of files) assert.ok(scripts["test:security"].includes(`tests/${file}`), `${file} missing from test:security`);
});
