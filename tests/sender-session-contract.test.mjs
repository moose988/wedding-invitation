import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, senderPage, functions] = await Promise.all([
  readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../send.js", import.meta.url), "utf8"),
  readFile(new URL("../functions/index.js", import.meta.url), "utf8"),
]);

test("live sender links carry only a revocable server capability; demo payloads stay explicit", () => {
  assert.match(dashboard, /httpsCallable\(state\.services\.functions, "createSenderSession"\)/);
  assert.match(dashboard, /send\.html#session=\$\{encodeURIComponent\(result\.data\.token\)\}/);
  assert.match(dashboard, /send\.html\?demo=1#data=/);
  assert.match(senderPage, /const demoMode = params\.get\("demo"\) === "1"/);
  assert.match(senderPage, /initPublicFirebase\(\)/);
  assert.match(senderPage, /httpsCallable\(functions, "getSenderSession"\)/);
  assert.match(senderPage, /window\.setInterval\(refreshSenderSession, 30_000\)/);
  assert.doesNotMatch(senderPage, /\binitFirebase\(\)/);
  assert.match(functions, /exports\.revokeSenderSession = onCall/);
  assert.match(functions, /const SENDER_SESSION_HOURS = 24/);
  assert.match(functions, /guestAccess = await Promise\.all/);
  assert.match(functions, /tokenHash: tokenHash\(await ensureInvitationSecret/);
});
