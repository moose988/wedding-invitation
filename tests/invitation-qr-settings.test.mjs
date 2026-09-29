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

test("seating is enabled for old events, persists per event, and gates seating UI across invitation designs", async () => {
  const [dashboard, rootInvitation, aliInvitation, invitationData, side, rules, weddings] = await Promise.all([
    read("dashboard.js"),
    read("script.js"),
    read("invitations/wedding-designs/ali-salma/invitation.js"),
    read("invitations/shared/invitation-data.js"),
    read("side.js"),
    read("firestore.rules"),
    read("weddings.js"),
  ]);

  assert.match(dashboard, /function isSeatingEnabled\(\)[\s\S]*?state\.wedding\?\.seatingEnabled !== false/);
  assert.match(dashboard, /data-action="toggle-seating-enabled"/);
  assert.match(dashboard, /role="switch" data-action="toggle-seating-enabled"/);
  assert.match(dashboard, /await updateDoc\(doc\(state\.services\.db, "weddings", state\.weddingId\), \{\s*seatingEnabled,/);
  assert.match(dashboard, /function ensureSenderSeatsReady[\s\S]*?if \(!isSeatingEnabled\(\)\) return true;/);
  assert.match(dashboard, /button\.dataset\.navView === "seating"\) button\.hidden = !isSeatingEnabled\(\)/);
  assert.match(dashboard, /nextUrl\.searchParams\.delete\("view"\)/);
  assert.match(dashboard, /isSeatingEnabled\(\) \? renderSeatingAccessCard\(\) : ""/);
  assert.match(rootInvitation, /!invitationSeatingEnabled\(state\.wedding\)/);
  assert.match(rootInvitation, /elements\.seatingSection\.hidden = true/);
  assert.match(aliInvitation, /invitationSeatingEnabled\(wedding\)/);
  assert.match(aliInvitation, /showSeating \? `<div><dt>Your seat<\/dt>/);
  assert.match(invitationData, /return wedding\?\.seatingEnabled !== false/);
  const helperSource = invitationData.match(/export function invitationSeatingEnabled\(wedding\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(helperSource, "shared seating flag helper exists");
  const seatingEnabled = new Function(`${helperSource.replace("export ", "")}; return invitationSeatingEnabled;`)();
  assert.equal(seatingEnabled({}), true, "older event documents default to seating enabled");
  assert.equal(seatingEnabled({ seatingEnabled: false, tables: [] }), false, "disabling seating works even when an event has no tables");
  assert.equal(seatingEnabled({ seatingEnabled: true, tables: [] }), true, "enabling seating remains valid when no tables exist yet");
  assert.match(side, /state\.wedding\.seatingEnabled === false/);
  assert.match(rules, /function isInvitationSeatingSettingsUpdate\(weddingId\)/);
  assert.match(rules, /hasOnly\(\["seatingEnabled", "updatedAt"\]\)/);
  assert.match(rules, /request\.resource\.data\.seatingEnabled is bool/);
  assert.match(rules, /\|\| isInvitationSeatingSettingsUpdate\(weddingId\)/);
  assert.match(weddings, /seatingEnabled:true/);
  assert.match(weddings, /seatingEnabled:wedding\.seatingEnabled !== false/);
});

test("canvas table and venue selection clear the opposing selection without centering", async () => {
  const dashboard = await read("dashboard.js");
  const pointerDown = dashboard.slice(
    dashboard.indexOf("function handlePlannerPointerDown("),
    dashboard.indexOf("function handlePlannerPointerMove("),
  );
  const clickHandlers = dashboard.slice(
    dashboard.indexOf('case "select-table":'),
    dashboard.indexOf('case "edit-dance-floor":'),
  );

  assert.match(pointerDown, /state\.selectedTableId = tableId;\s*state\.selectedHallObjectId = ""/);
  assert.match(pointerDown, /state\.selectedHallObjectId = objectId;\s*state\.selectedTableId = ""/);
  assert.match(clickHandlers, /case "select-table":[\s\S]*?state\.selectedHallObjectId = ""/);
  assert.match(clickHandlers, /case "select-hall-object":[\s\S]*?state\.selectedTableId = ""/);
  assert.doesNotMatch(clickHandlers, /scrollPlannerToElement/);
  assert.doesNotMatch(dashboard, /function scrollPlannerToElement\(/);
});

test("wedding workspace cards always expose a menu trigger without exposing owner actions", async () => {
  const [workspace, styles] = await Promise.all([read("weddings.js"), read("weddings.css")]);

  assert.match(workspace, /const cardMenu =/);
  assert.match(workspace, /class="card-menu-toggle"/);
  assert.match(workspace, /Only the event owner can manage this event\./);
  assert.match(styles, /\.action-menu \{ top:calc\(100% \+ 8px\); bottom:auto; z-index:10;/);
});
