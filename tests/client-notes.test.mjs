import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { INTEREST_SUGGESTIONS, MAX_INTERESTS, NOTES_PAGE, addInterest, buildNoteData, initials, isEdited, noteBubbleHtml, noteMatches, relativeTime, snippet, sortNotes } from "../client-notes-core.js";

const read = f => readFile(new URL(`../${f}`, import.meta.url), "utf8");
const ts = ms => ({ toMillis: () => ms });

test("a note is built in exactly the shape the rules allow, with price in integer fils", () => {
  const ok = buildNoteData({ text: " Wants 80 seats ", priceText: "4,500.50", interests: ["Invitation"], pinned: true, authorUid: "u1", authorName: "Sara Khan" });
  assert.equal(ok.ok, true);
  assert.deepEqual(Object.keys(ok.data).sort(), ["authorName", "authorUid", "currency", "interests", "pinned", "priceFils", "text"]);
  assert.equal(ok.data.priceFils, 450050); assert.equal(ok.data.currency, "AED"); assert.equal(ok.data.text, "Wants 80 seats");
  const noPrice = buildNoteData({ text: "hi", authorUid: "u", authorName: "A" });
  assert.ok(!("priceFils" in noPrice.data) && !("currency" in noPrice.data), "currency only with a price");
  assert.equal(buildNoteData({ text: "  ", authorUid: "u" }).ok, false);
  assert.deepEqual(buildNoteData({ text: "x", interests: ["  Seating ", "   ", ""], authorUid: "u" }).data.interests, ["Seating"], "interests are trimmed and empties dropped");
  assert.equal(buildNoteData({ text: "x", priceText: "1.234", authorUid: "u" }).ok, false);
  assert.equal(buildNoteData({ text: "x".repeat(5001), authorUid: "u" }).ok, false);
  assert.equal(buildNoteData({ text: "x", authorUid: "u", authorName: "n".repeat(200) }).data.authorName.length, 80);
});

test("interest chips: de-duplicated, trimmed to 40 characters, at most 10", () => {
  let list = []; for (const t of ["Invitation", "invitation", "  Seating  ", "", "a".repeat(60)]) list = addInterest(list, t);
  assert.deepEqual(list.slice(0, 2), ["Invitation", "Seating"]); assert.equal(list[2].length, 40);
  for (let i = 0; i < 20; i++) list = addInterest(list, `t${i}`);
  assert.equal(list.length, MAX_INTERESTS);
  assert.deepEqual([...INTEREST_SUGGESTIONS], ["Invitation", "Photo Bucket", "Seating", "Gender reveal", "Demo"]);
  assert.equal(NOTES_PAGE, 30);
});

test("pinned first then newest, search by text or interest, edited marker, relative time", () => {
  const notes = [{ id: "a", createdAt: ts(1000), text: "old pinned", pinned: true }, { id: "b", createdAt: ts(3000), text: "new Seating chat", interests: ["Seating"] }, { id: "c", createdAt: ts(2000), text: "mid" }];
  assert.deepEqual(sortNotes(notes).map(n => n.id), ["a", "b", "c"]);
  assert.equal(noteMatches(notes[1], "seating chat"), true); assert.equal(noteMatches(notes[1], "", "seating"), true); assert.equal(noteMatches(notes[2], "", "Seating"), false);
  assert.equal(isEdited({ createdAt: ts(1000), updatedAt: ts(1500) }), false); assert.equal(isEdited({ createdAt: ts(1000), updatedAt: ts(60000) }), true);
  const now = 10_000_000_000;
  assert.equal(relativeTime(now - 2 * 3600e3, now), "2 h ago"); assert.equal(relativeTime(now - 5 * 60e3, now), "5 min ago");
  assert.equal(initials("Sara Khan"), "SK"); assert.equal(initials(""), "?"); assert.equal(snippet("a  b\nc", 80), "a b c");
});

test("bubbles show author initials, price badge, chips, edited and pinned markers, and escape everything", () => {
  const html = noteBubbleHtml({ id: "n<1>", text: "<script>x</script>", authorName: "Ann Lee<b>", createdAt: ts(1000), updatedAt: ts(99999), priceFils: 12500, interests: ["<i>x</i>"], pinned: true }, 5000000);
  assert.doesNotMatch(html, /<script|<b>|<i>/);
  for (const part of [/>AL</, /AED 125\.00/, /note__edited/, /note__pin/, /data-note-action="edit"/, /data-note-action="delete"/, /data-note-action="pin"/, /title="/]) assert.match(html, part);
});

test("the client page wires notes: composer, list snippet and count, quick add, delete cascade", async () => {
  const [c, n, css] = await Promise.all(["clients.js", "client-notes.js", "clients.css"].map(read));
  assert.match(c, /mountNotes\(/); assert.match(c, /data-quick-note/); assert.match(c, /loadNotesMeta/); assert.match(c, /\["notes", "quotes"\]\) await deleteAll/); assert.match(c, /limit\(400\)/);
  assert.match(n, /No notes yet\./); assert.match(n, /Add what you discussed\./); assert.match(n, /data-note-retry/); assert.match(n, /skeleton\.rows/);
  assert.match(n, /Delete this note\?/); assert.match(n, /where\("pinned", "==", true\)/); assert.match(n, /getCountFromServer/);
  assert.match(css, /hover: hover/); assert.doesNotMatch(n, /parseFloat|toFixed|<script|onclick=/);
});
