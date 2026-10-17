import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboard, senderPage, rules, codec] = await Promise.all([
  readFile(new URL("../dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../send.js", import.meta.url), "utf8"),
  readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  readFile(new URL("../sender-codec.js", import.meta.url), "utf8"),
]);

test("live sender links use a random Firestore capability and bounded recipient chunks", () => {
  assert.match(dashboard, /generateInvitationToken\(\)/);
  assert.match(dashboard, /"senderCapabilities", token/);
  assert.match(dashboard, /chunkSize = 20/);
  assert.match(dashboard, /recipients: recipients\.slice\(offset, offset \+ chunkSize\)/);
  assert.match(dashboard, /status: "preparing"/);
  assert.match(dashboard, /status: "active"/);
  assert.match(dashboard, /link\.hash = new URLSearchParams\(\{ capability: token \}\)\.toString\(\)/);
  assert.match(dashboard, /send\.html\?demo=1#data=/);
  assert.match(senderPage, /getDoc\(capabilityRef\)/);
  assert.match(senderPage, /getDoc\(doc\(db, "weddings", record\.weddingId, "senderCapabilities", capabilityToken, "recipients", chunkId\)\)/);
  assert.match(senderPage, /credential\.recipient = guest\.i/);
  assert.doesNotMatch(senderPage, /httpsCallable|getFunctions|getDocs\(collection\(db, .*senderCapabilities/);
  assert.match(rules, /allow list: if isEventOwner\(weddingId\);[\s\S]*?match \/recipients\/\{chunkId\}[\s\S]*?allow list: if false/);
  assert.match(rules, /data\.recipientCount <= 2000/);
  assert.match(rules, /data\.recipients\.size\(\) <= 20/);
  assert.match(codec, /p: guest\.phone \|\| ""/);
});

test("sender URL recipient binding survives into the RSVP hash", () => {
  assert.match(senderPage, /function buildInviteLink\(guest\)[\s\S]*?credential\.recipient = guest\.i[\s\S]*?url\.hash = new URLSearchParams\(credential\)\.toString\(\)/);
  assert.match(senderPage, /https:\/\/wa\.me\/\$\{guest\.p\}/);
  assert.match(senderPage, /sessionStorage/);
  assert.match(rules, /match \/senderCapabilities\/\{capabilityId\}[\s\S]*?allow update:[\s\S]*?status in \["active", "revoked"\]/);
});

test("sender capability links disclose only the selected recipient fields to bearer holders", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /Anyone holding a sender link can see the selected recipient names, phone numbers, and invitation links/);
  assert.doesNotMatch(codec, /email:|notes:|fullRoster/);
});
