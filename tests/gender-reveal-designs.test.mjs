import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { genderRevealInvitationUrl, getGenderRevealDesign } from "../invitations/gender-reveal-designs/registry.js";

test("gender reveal links follow the saved template; unknown or missing choices stay on the classic page", () => {
  const base = "https://example.test/dashboard.html";
  assert.equal(new URL(genderRevealInvitationUrl("abc123", "petit-nuage", base)).pathname, "/invitations/gender-reveal-designs/petit-nuage/index.html");
  assert.equal(new URL(genderRevealInvitationUrl("abc123", "petit-nuage", base)).searchParams.get("wedding"), "abc123");
  for (const value of [undefined, "", "gender-reveal-classic", "unknown", "../../evil", "__proto__", "toString"]) {
    assert.equal(new URL(genderRevealInvitationUrl("abc123", value, base)).pathname, "/gender-reveal.html");
  }
  assert.equal(getGenderRevealDesign("petit-nuage").name, "Petit Nuage");
});

test("both event pickers offer Petit Nuage for gender reveals", async () => {
  for (const page of ["all-events.html", "customer-events.html"]) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /data-template-category="gender_reveal"[^>]*><input type="radio" name="invitationTemplate" value="petit-nuage"/);
  }
});

test("Petit Nuage keeps the shared guest flow and ships its own assets", async () => {
  const html = await readFile(new URL("../invitations/gender-reveal-designs/petit-nuage/index.html", import.meta.url), "utf8");
  for (const id of ["cover", "openInvitation", "openingVideo", "skipOpening", "responseForm", "fullName", "message", "submitResponse", "thankYou", "results", "boyPercent", "girlPercent", "eventMusic", "musicToggle"]) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  for (const name of ["attendance", "prediction"]) assert.match(html, new RegExp(`name="${name}"`));
  assert.match(html, /QD Systems/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/, "inline scripts are blocked by the site CSP");
  for (const asset of ["cover.webp", "opening.mp4", "baby.webp", "bottle.webp", "booties.webp", "mobile.webp", "team-boy.webp", "team-girl.webp", "thumbnail.webp", "balloon.svg"]) {
    await readFile(new URL(`../invitations/gender-reveal-designs/petit-nuage/assets/${asset}`, import.meta.url));
  }
});
