import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getWeddingDesign, getInvitationRoute } from "../invitations/wedding-designs/registry.js";
import { publicEventData } from "../event-publishing.js";

test("saved template choices route new event IDs, while live assignments always win", () => {
  const base = "https://example.test/index.html";
  for (const id of ["new-random-id", "another-event"]) {
    assert.equal(getWeddingDesign(id, "moonlit-conservatory").designId, "moonlit-conservatory");
    assert.equal(getInvitationRoute(id, base, "moonlit-conservatory").pathname, "/invitations/wedding-designs/moonlit-conservatory/index.html");
    assert.equal(getWeddingDesign(id, "layla-zaid").designId, "layla-zaid");
    assert.equal(getWeddingDesign(id, "pomegranate-courtyard").designId, "pomegranate-courtyard");
    assert.equal(getInvitationRoute(id, base, "pomegranate-courtyard").pathname, "/invitations/wedding-designs/pomegranate-courtyard/index.html");
    assert.equal(getWeddingDesign(id, "mandoos").designId, "mandoos");
    assert.equal(getInvitationRoute(id, base, "mandoos").pathname, "/invitations/wedding-designs/mandoos/index.html");
    assert.equal(getInvitationRoute(id, base, "yasmine").pathname, "/invitations/wedding-designs/yasmine/index.html");
    assert.equal(getInvitationRoute(id, base, "shiraa").pathname, "/invitations/wedding-designs/shiraa/index.html");
    for (const value of ["", "unknown", "../../evil", "__proto__", "toString"]) assert.equal(getWeddingDesign(id, value), null);
  }
  assert.equal(getWeddingDesign("luxury-wedding-demo", "moonlit-conservatory").designId, "layla-zaid");
  assert.equal(getWeddingDesign("M1S1aBL9134GSAozWh6G", "moonlit-conservatory").designId, "ali-salma");
  assert.equal(getWeddingDesign("toString"), null);
});

test("publication carries the distinct choice; omitted legacy fields stay omitted", () => {
  assert.equal(publicEventData({ invitationTemplate: "moonlit-conservatory" }).invitationTemplate, "moonlit-conservatory");
  assert.equal(Object.hasOwn(publicEventData({}), "invitationTemplate"), false);
});

test("both creation surfaces expose the new card and leave Floral Wedding selected", async () => {
  for (const file of ["all-events.html", "customer-events.html"]) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(html, /value="layla-zaid" checked/);
    assert.match(html, /value="moonlit-conservatory" \/>/);
    assert.match(html, /moonlit-conservatory\/assets\/thumbnail.webp/);
    assert.match(html, /value="pomegranate-courtyard" \/>/);
    assert.match(html, /pomegranate-courtyard\/assets\/thumbnail.webp/);
    assert.match(html, /value="mandoos" \/>/);
    assert.match(html, /mandoos\/assets\/thumbnail.webp/);
    assert.match(html, /value="yasmine" \/>/);
    assert.match(html, /value="shiraa" \/>/);
    assert.match(html, /shiraa\/assets\/thumbnail.webp/);
  }
});

test("Pomegranate Courtyard is an allowed published template and ships its own assets", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /"pomegranate-courtyard", "mandoos", "yasmine"\]/);
  const html = await readFile(new URL("../invitations/wedding-designs/pomegranate-courtyard/index.html", import.meta.url), "utf8");
  for (const id of ["introScreen", "openInvitation", "openingVideo", "skipOpening", "musicToggle", "weddingAudio", "siteContent", "heroSection", "countdownGrid", "detailsGrid", "scheduleMount", "seatingMap", "rsvpMount", "qrPassMount", "stickyActions", "toastRail"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  for (const asset of ["opening.webp", "opening.mp4", "courtyard-loop.mp4", "courtyard-loop-portrait.mp4", "chair.svg", "thumbnail.webp"]) {
    await readFile(new URL(`../invitations/wedding-designs/pomegranate-courtyard/assets/${asset}`, import.meta.url));
  }
});

test("Mandoos is an allowed published template and ships its own assets", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /"mandoos", "yasmine"\]/);
  const html = await readFile(new URL("../invitations/wedding-designs/mandoos/index.html", import.meta.url), "utf8");
  for (const id of ["introScreen", "openInvitation", "openingVideo", "skipOpening", "musicToggle", "weddingAudio", "siteContent", "heroSection", "countdownGrid", "detailsGrid", "scheduleMount", "seatingMap", "rsvpMount", "qrPassMount", "stickyActions", "toastRail"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  for (const asset of ["opening.webp", "opening.mp4", "inside-loop.mp4", "inside-loop-portrait.mp4", "mabkhara-loop.mp4", "henna-medallion.webp", "henna-vine.webp", "chair.svg", "thumbnail.webp"]) {
    await readFile(new URL(`../invitations/wedding-designs/mandoos/assets/${asset}`, import.meta.url));
  }
});

test("Yasmine is an allowed published template and ships its own assets", async () => {
  const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /"yasmine"\]/);
  const html = await readFile(new URL("../invitations/wedding-designs/yasmine/index.html", import.meta.url), "utf8");
  for (const id of ["introScreen", "openInvitation", "openingVideo", "skipOpening", "musicToggle", "weddingAudio", "siteContent", "heroSection", "countdownGrid", "detailsGrid", "scheduleMount", "seatingMap", "rsvpMount", "qrPassMount", "stickyActions", "toastRail"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  for (const asset of ["opening.webp", "opening.mp4", "terrace-loop.mp4", "terrace-loop-portrait.mp4", "olive-wreath.webp", "chair.svg", "thumbnail.webp"]) {
    await readFile(new URL(`../invitations/wedding-designs/yasmine/assets/${asset}`, import.meta.url));
  }
});

test("Shiraa ships its shell and its own assets", async () => {
  const html = await readFile(new URL("../invitations/wedding-designs/shiraa/index.html", import.meta.url), "utf8");
  for (const id of ["introScreen", "openInvitation", "openingVideo", "skipOpening", "musicToggle", "weddingAudio", "siteContent", "heroSection", "countdownGrid", "detailsGrid", "scheduleMount", "seatingMap", "rsvpMount", "qrPassMount", "stickyActions", "toastRail", "shVeil"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  for (const asset of ["opening.webp", "opening.mp4", "hero.webp", "hero-portrait.webp", "garland.webp", "chair.svg", "thumbnail.webp"]) {
    await readFile(new URL(`../invitations/wedding-designs/shiraa/assets/${asset}`, import.meta.url));
  }
});
