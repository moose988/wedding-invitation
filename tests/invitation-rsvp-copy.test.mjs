import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../script.js", import.meta.url), "utf8");
const start = source.indexOf("function renderFirebaseRsvp(mount)");
const end = source.indexOf("\nfunction renderDemoRsvp(", start);
const renderFirebaseRsvpSource = source.slice(start, end);

function renderFirebaseRsvp(isLayla) {
  const mount = { innerHTML: "" };
  const form = {
    addEventListener() {},
    querySelector() { return null; },
  };
  const context = vm.createContext({
    mount,
    state: {
      guest: { fullName: "Guest" },
      wedding: {},
      laylaLanguage: "en",
      isRsvpEditing: true,
      isRsvpSaving: false,
      rsvpSaveError: "",
      rsvpSelection: "",
      rsvpMessage: "",
    },
    invitationRsvpView: () => ({ showSummary: false }),
    isLaylaInvitation: () => isLayla,
    laylaText: (key) => ({
      attending: "Will you be joining us?",
      yes: "Yes, I'll be there.",
      no: "Can't make it.",
    })[key] || key,
    escapeHtml: (value) => String(value),
    escapeAttribute: (value) => String(value),
    icons: { reply: "" },
    document: { getElementById: () => form },
    handleFirebaseRsvpSubmit() {},
    setupRsvpPhases() {},
  });
  vm.runInContext(`${renderFirebaseRsvpSource}; renderFirebaseRsvp(mount);`, context);
  return mount.innerHTML;
}

test("Layla RSVP keeps the invitation question and removes the duplicate form heading", () => {
  const layla = renderFirebaseRsvp(true);
  assert.doesNotMatch(layla, /<h3>Will you be joining us\?<\/h3>/);
  assert.doesNotMatch(layla, /class="rsvp-phase__number"/);
  assert.match(layla, /aria-label="Will you be joining us\?"/);
  assert.match(layla, /Yes, I'll be there\./);
  assert.match(layla, /Can't make it\./);

  const otherDesign = renderFirebaseRsvp(false);
  assert.match(otherDesign, /<h3>Are you attending\?<\/h3>/);
  assert.match(otherDesign, /class="rsvp-phase__number">01<\/p>/);
});
