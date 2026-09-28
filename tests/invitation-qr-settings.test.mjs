import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("invitation QR visibility defaults to enabled and is synchronized through event listeners", async () => {
  const [dashboard, rootInvitation, aliInvitation, rules] = await Promise.all([
    read("dashboard.js"),
    read("script.js"),
    read("invitations/wedding-designs/ali-salma/invitation.js"),
    read("firestore.rules"),
  ]);

  assert.match(dashboard, /state\.wedding\?\.showInvitationQr !== false/);
  assert.match(dashboard, /data-action="toggle-invitation-qr"/);
  assert.match(dashboard, /await updateDoc\(doc\(state\.services\.db, "weddings", state\.weddingId\), \{\s*showInvitationQr,/);
  assert.match(dashboard, /startWeddingListener\(\)/);
  assert.match(rootInvitation, /state\.wedding\?\.showInvitationQr === false/);
  assert.match(rootInvitation, /elements\.qrPassSection\.hidden = true/);
  assert.match(aliInvitation, /const showQr = wedding\.showInvitationQr !== false/);
  assert.match(aliInvitation, /if \(showQr\) renderQrCode/);
  assert.match(rules, /function isInvitationQrSettingsUpdate\(weddingId\)/);
  assert.match(
    rules,
    /request\.auth\.uid == resource\.data\.ownerUserId \|\| canManageUsers\(weddingId\)/,
  );
  assert.match(rules, /hasOnly\(\["showInvitationQr", "updatedAt"\]\)/);
  assert.match(rules, /request\.resource\.data\.showInvitationQr is bool/);
  assert.match(rules, /request\.resource\.data\.updatedAt == request\.time/);
  assert.match(rules, /\|\| isInvitationQrSettingsUpdate\(weddingId\)/);
});

test("wedding workspace cards always expose a menu trigger without exposing owner actions", async () => {
  const [workspace, styles] = await Promise.all([read("weddings.js"), read("weddings.css")]);

  assert.match(workspace, /const cardMenu =/);
  assert.match(workspace, /class="card-menu-toggle"/);
  assert.match(workspace, /Only the event owner can manage this event\./);
  assert.match(styles, /\.action-menu \{ top:calc\(100% \+ 8px\); bottom:auto; z-index:10;/);
});
