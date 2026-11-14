// Platform-admin "Templates" tab: copy the customer templates link, set the
// WhatsApp number for its "I want this one" button, and hide or show templates
// on that page. Hiding only affects templates.html; admins still see every
// template here and in the event template picker.
import { doc, getDoc, serverTimestamp, setDoc } from "./firebase-config.js";
import { SHOWCASE_CATEGORIES, SHOWCASE_SETTINGS_PATH, SHOWCASE_TEMPLATES, normalizeShowcaseSettings, showcaseLink } from "./template-catalog.js";
import { copyWithFallback } from "./action-feedback.js";
import { esc } from "./admin-api.js";

let view = null;

export async function buildTemplates(root, { db, user }) {
  view = { root, db, user, settings: { hidden: [], whatsapp: "" }, saving: false };
  const base = location.href;
  root.innerHTML = `
    <div class="admin-panel__head"><div><h2 id="adminTemplatesTitle">Templates</h2>
      <p>A page where customers browse your invitation designs and open each one on their phone, as a guest would. Hiding a template takes it off that page only: you still see it here and can choose it for any event.</p></div></div>
    <section class="admin-card tpl-share" aria-labelledby="tplShareTitle">
      <h3 id="tplShareTitle">Link for customers</h3>
      <label for="tplLink" class="tpl-label">All templates</label><div class="tpl-field"><input id="tplLink" readonly value="${esc(showcaseLink(base))}" /><button class="primary-button" type="button" data-copy-link="">Copy link</button><a class="secondary-button" href="${esc(showcaseLink(base))}" target="_blank" rel="noopener">Open</a></div>
      <p class="admin-meta">Or send a link that opens on one event type:</p>
      <div class="admin-actions">${SHOWCASE_CATEGORIES.map(c => `<button class="secondary-button" type="button" data-copy-link="${c.id}">Copy ${esc(c.short.en.toLowerCase())} link</button>`).join("")}</div>
    </section>
    <form class="admin-card tpl-whatsapp" id="tplWhatsappForm" novalidate>
      <h3>"I want this one" button</h3>
      <label for="tplWhatsapp" class="tpl-label">WhatsApp number, with country code</label>
      <div class="tpl-field"><input id="tplWhatsapp" type="tel" inputmode="tel" autocomplete="off" placeholder="+971 50 461 1123 (default)" aria-describedby="tplWhatsappHelp" /><button class="primary-button" type="submit" id="tplWhatsappSave">Save</button></div>
      <p class="admin-meta" id="tplWhatsappHelp">When a customer is viewing a template, the button opens WhatsApp to this number with the template's name already typed. Leave it empty to use the support number, +971 50 461 1123.</p>
      <p class="form-error" id="tplWhatsappError" role="alert"></p>
    </form>
    <section class="admin-card" aria-labelledby="tplListTitle">
      <div class="admin-panel__head"><h3 id="tplListTitle">Shown to customers</h3><p class="admin-meta" id="tplSummary" role="status">Loading…</p></div>
      <div id="tplList">${SHOWCASE_CATEGORIES.map(c => `<h4 class="tpl-group">${esc(c.name.en)}</h4><ul class="tpl-list" role="list">${SHOWCASE_TEMPLATES.filter(t => t.category === c.id).map(row).join("")}</ul>`).join("")}</div>
      <p class="form-error" id="tplError" role="alert"></p>
    </section>`;

  root.querySelectorAll("[data-copy-link]").forEach(button => button.addEventListener("click", () => {
    void (async () => {
      const original = button.textContent;
      if (await copyWithFallback(showcaseLink(base, button.dataset.copyLink), { title: "Copy the templates link" })) {
        button.textContent = "Copied"; setTimeout(() => { button.textContent = original; }, 1600);
      }
    })();
  }));
  root.querySelectorAll("[data-toggle]").forEach(input => input.addEventListener("change", () => toggle(input)));
  root.querySelector("#tplWhatsappForm").addEventListener("submit", saveWhatsapp);
  await load();
}

function row(t) {
  return `<li class="tpl-row" data-id="${t.id}">
    <img src="${esc(t.thumb)}" alt="" loading="lazy" />
    <div class="tpl-row__text"><strong>${esc(t.name.en)}</strong><span>${esc(t.blurb.en)}</span></div>
    <a class="secondary-button" href="${esc(t.url)}" target="_blank" rel="noopener">View</a>
    <label class="tpl-switch"><input type="checkbox" data-toggle="${t.id}" checked disabled /><span aria-hidden="true"></span><em>Shown</em><span class="sr-only"> on the customer page: ${esc(t.name.en)}</span></label>
  </li>`;
}

async function load() {
  const { root, db } = view;
  try {
    const snap = await getDoc(doc(db, ...SHOWCASE_SETTINGS_PATH));
    view.settings = normalizeShowcaseSettings(snap.exists() ? snap.data() : {});
    root.querySelector("#tplError").textContent = "";
  } catch (error) {
    root.querySelector("#tplError").textContent = `The settings could not load: ${error?.message || error?.code || "please try again."} Every template is shown to customers until this loads.`;
  }
  root.querySelector("#tplWhatsapp").value = view.settings.whatsapp ? `+${view.settings.whatsapp}` : "";
  paint();
}

function paint() {
  const { root, settings } = view;
  root.querySelectorAll("[data-toggle]").forEach(input => {
    const shown = !settings.hidden.includes(input.dataset.toggle);
    input.checked = shown; input.disabled = view.saving;
    input.closest(".tpl-row").classList.toggle("is-hidden", !shown);
    input.parentElement.querySelector("em").textContent = shown ? "Shown" : "Hidden";
  });
  const shownCount = SHOWCASE_TEMPLATES.length - settings.hidden.length;
  root.querySelector("#tplSummary").textContent = `${shownCount} of ${SHOWCASE_TEMPLATES.length} templates are on the customer page.`;
}

async function save(next, what) {
  view.saving = true; paint();
  try {
    await setDoc(doc(view.db, ...SHOWCASE_SETTINGS_PATH), { hidden: next.hidden, whatsapp: next.whatsapp, updatedAt: serverTimestamp(), updatedBy: view.user.uid });
    view.settings = next;
    view.root.querySelector("#tplError").textContent = "";
    return true;
  } catch (error) {
    view.root.querySelector("#tplError").textContent = `${what} could not be saved: ${error?.message || error?.code || "please try again."}`;
    return false;
  } finally { view.saving = false; paint(); }
}

async function toggle(input) {
  const id = input.dataset.toggle, shown = input.checked;
  const hidden = shown ? view.settings.hidden.filter(x => x !== id) : [...view.settings.hidden, id];
  await save({ ...view.settings, hidden }, "The change");
}

async function saveWhatsapp(event) {
  event.preventDefault();
  const input = view.root.querySelector("#tplWhatsapp"), error = view.root.querySelector("#tplWhatsappError"), button = view.root.querySelector("#tplWhatsappSave");
  const raw = input.value.trim(), digits = raw.replace(/\D/g, "");
  if (raw && (digits.length < 8 || digits.length > 15 || /[^\d\s+()-]/.test(raw))) { error.textContent = "Enter the full number with its country code, for example +971 50 123 4567."; input.focus(); return; }
  error.textContent = ""; button.disabled = true; button.textContent = "Saving…";
  const ok = await save({ ...view.settings, whatsapp: digits }, "The number");
  button.disabled = false; button.textContent = ok ? "Saved" : "Save";
  if (ok) { input.value = digits ? `+${digits}` : ""; setTimeout(() => { button.textContent = "Save"; }, 1600); }
}
