import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [login, dashboard, invitation] = await Promise.all([
  readFile(new URL("../dashboard-login.js", import.meta.url), "utf8"),
  readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../script.js", import.meta.url), "utf8"),
]);

test("opening login or a public invitation does not clear the shared Firebase Auth session", () => {
  assert.doesNotMatch(login, /\bsignOut\s*\(/);
  assert.doesNotMatch(login, /\bsignOut\b/);
  assert.doesNotMatch(invitation, /\bsignOut\s*\(/);
});

test("explicit dashboard sign-out remains wired to its user action", () => {
  assert.match(dashboard, /signOutButton\?\.addEventListener\("click"/);
  assert.match(dashboard, /await signOut\(state\.services\.auth\)/);
});
