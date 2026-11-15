import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  SHOWCASE_CATEGORIES, SHOWCASE_TEMPLATES, normalizeShowcaseSettings, showcaseLink, visibleTemplates, whatsappLink
} from "../template-catalog.js";
import { weddingTemplateRegistry } from "../invitations/wedding-designs/registry.js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every showcase template has a thumbnail and a sample page that exist", () => {
  const ids = new Set();
  for (const t of SHOWCASE_TEMPLATES) {
    assert.ok(!ids.has(t.id), `duplicate id ${t.id}`); ids.add(t.id);
    assert.ok(SHOWCASE_CATEGORIES.some(c => c.id === t.category), `${t.id} has a known category`);
    assert.ok(t.name.en && t.name.ar && t.blurb.en && t.blurb.ar, `${t.id} has English and Arabic copy`);
    assert.ok(existsSync(new URL(`../${t.thumb}`, import.meta.url)), `${t.id} thumbnail exists`);
    const page = t.url.split("?")[0];
    assert.ok(existsSync(new URL(`../${page}`, import.meta.url)), `${t.id} page exists`);
    assert.match(t.url, /[?&]sample=1/, `${t.id} opens its sample`);
  }
});

test("every wedding and celebration design in the picker is offered to customers", () => {
  const offered = new Set(SHOWCASE_TEMPLATES.map(t => t.id));
  for (const id of Object.keys(weddingTemplateRegistry)) {
    if (id === "ali-salma") continue; // legacy, not in the picker
    assert.ok(offered.has(id), `${id} is on the templates page`);
  }
});

test("hidden templates are left off the customer page and bad data is ignored", () => {
  const settings = { hidden: ["shiraa", "not-a-template", "shiraa", 5], whatsapp: "+971 (50) 123-4567" };
  assert.deepEqual(normalizeShowcaseSettings(settings), { hidden: ["shiraa"], whatsapp: "971501234567" });
  const shown = visibleTemplates(settings).map(t => t.id);
  assert.ok(!shown.includes("shiraa"));
  assert.equal(shown.length, SHOWCASE_TEMPLATES.length - 1);
  assert.deepEqual(visibleTemplates({}, "celebration").map(t => t.id), ["ember"]);
  assert.deepEqual(normalizeShowcaseSettings(null ?? undefined), { hidden: [], whatsapp: "" });
});

test("links: one general link, one per event type, and WhatsApp", () => {
  const base = "https://qd.example/all-events.html#templates";
  assert.equal(showcaseLink(base), "https://qd.example/templates.html");
  assert.equal(showcaseLink(base, "gender_reveal"), "https://qd.example/templates.html?event=gender_reveal");
  assert.equal(showcaseLink(base, "nope"), "https://qd.example/templates.html");
  assert.match(whatsappLink("", "Ember"), /^https:\/\/wa\.me\/971504611123\?text=/);
  const wa = new URL(whatsappLink("+971 50 123 4567", "Ember"));
  assert.equal(wa.origin + wa.pathname, "https://wa.me/971501234567");
  assert.match(wa.searchParams.get("text"), /"Ember"/);
});

test("only platform admins can change the showcase setting; anyone can read it", () => {
  const rules = read("firestore.rules");
  const block = rules.slice(rules.indexOf("match /siteSettings/templateShowcase"), rules.indexOf("match /platformAdmins/"));
  assert.match(block, /allow get: if true;/);
  assert.match(block, /allow list, delete: if false;/);
  assert.match(block, /allow create, update: if isPlatformAdmin\(\)/);
  assert.match(block, /hasOnly\(\["hidden", "whatsapp", "updatedAt", "updatedBy"\]\)/);
});

test("the admin workspace has a Templates tab and other admin pages link to it", () => {
  const page = read("all-events.html");
  assert.match(page, /href="\.\/all-events\.html#templates" data-section="templates">Templates</);
  assert.match(page, /id="adminTemplates"/);
  const workspace = read("admin-workspace.js");
  assert.match(workspace, /"templates"\]/);
  assert.match(workspace, /import\("\.\/admin-templates\.js"\)/);
  for (const file of ["clients.html", "customers.html"]) assert.match(read(file), /all-events\.html#templates">Templates</);
  assert.match(read("weddings.css"), /#workspace\[data-section="templates"\]/);
});

test("the customer page loads the catalog, has the language switch, and opens a design on its own full screen", () => {
  const html = read("templates.html");
  for (const id of ["gallery", "filters", "langToggle"]) assert.match(html, new RegExp(`id="${id}"`));
  // No bar or frame around the invitation: a tap opens it exactly as a guest gets it.
  assert.doesNotMatch(html, /id="viewer"|<iframe/);
  const js = read("templates.js");
  assert.match(js, /visibleTemplates\(/);
  assert.match(js, /initPublicFirebase\(/);
  assert.match(js, /location\.assign\(item\.url\)/);
});
