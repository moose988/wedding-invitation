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
  }
});
