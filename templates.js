// Public templates page: customers browse the invitation designs and open each
// one full screen. Templates an admin has hidden (siteSettings/templateShowcase)
// are left out. ?event=wedding|gender_reveal|celebration opens on one event type.
import { SHOWCASE_CATEGORIES, SHOWCASE_SETTINGS_PATH, SHOWCASE_TEMPLATES, normalizeShowcaseSettings, visibleTemplates, whatsappLink } from "./template-catalog.js";

const $ = id => document.getElementById(id);
const LANG_KEY = "qd-templates-lang";
const COPY = {
  en: {
    skip: "Skip to the templates", kicker: "Digital invitations", title: "Choose your invitation",
    lede: "Tap any design to open it full screen, exactly as your guests will see it on their phones.",
    loading: "Loading the templates…", all: "All", view: "View invitation", back: "All templates", want: "I want this one",
    foot: "Every design includes RSVP, a countdown, the venue map and English and Arabic.",
    empty: "No templates to show here yet.", count: n => `${n} design${n === 1 ? "" : "s"}`, langLabel: "عرض الصفحة بالعربية"
  },
  ar: {
    skip: "انتقل إلى التصاميم", kicker: "دعوات رقمية", title: "اختر دعوتك",
    lede: "اضغط على أي تصميم لفتحه بملء الشاشة، تمامًا كما سيراه ضيوفك على هواتفهم.",
    loading: "جارٍ تحميل التصاميم…", all: "الكل", view: "عرض الدعوة", back: "كل التصاميم", want: "أريد هذا التصميم",
    foot: "كل تصميم يشمل تأكيد الحضور والعدّ التنازلي وخريطة المكان، بالعربية والإنجليزية.",
    empty: "لا توجد تصاميم هنا بعد.", count: n => (n === 1 ? "تصميم واحد" : n === 2 ? "تصميمان" : `${n} تصاميم`), langLabel: "View the page in English"
  }
};

const params = new URLSearchParams(location.search);
const state = {
  lang: readLang(),
  filter: SHOWCASE_CATEGORIES.some(c => c.id === params.get("event")) ? params.get("event") : "",
  settings: { hidden: [], whatsapp: "" },
  ready: false
};

function readLang() {
  try { const saved = localStorage.getItem(LANG_KEY); if (saved === "en" || saved === "ar") return saved; } catch { /* storage may be blocked */ }
  return (navigator.language || "").toLowerCase().startsWith("ar") ? "ar" : "en";
}
const t = key => COPY[state.lang][key];
const esc = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

function applyLang() {
  const ar = state.lang === "ar";
  document.documentElement.lang = state.lang;
  document.documentElement.dir = ar ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach(node => { const v = COPY[state.lang][node.dataset.i18n]; if (typeof v === "string") node.textContent = v; });
  $("langToggle").setAttribute("aria-label", t("langLabel"));
  $("langToggle").dataset.active = state.lang;
  document.title = ar ? "تصاميم الدعوات · QD Systems" : "Invitation templates · QD Systems";
}

function renderFilters() {
  const shown = visibleTemplates(state.settings);
  const cats = SHOWCASE_CATEGORIES.filter(c => shown.some(x => x.category === c.id));
  // A category link with nothing visible falls back to everything.
  if (state.ready && state.filter && !cats.some(c => c.id === state.filter)) state.filter = "";
  const chip = (id, label) => `<button type="button" class="tp-chip" data-filter="${id}" aria-pressed="${state.filter === id}">${esc(label)}</button>`;
  $("filters").innerHTML = cats.length > 1 ? chip("", t("all")) + cats.map(c => chip(c.id, c.short[state.lang])).join("") : "";
}

function renderGallery() {
  const gallery = $("gallery");
  gallery.setAttribute("aria-busy", "false");
  const shown = visibleTemplates(state.settings, state.filter);
  if (!shown.length) { gallery.innerHTML = `<p class="tp-empty">${esc(t("empty"))}</p>`; return; }
  const groups = SHOWCASE_CATEGORIES.map(c => ({ c, items: shown.filter(x => x.category === c.id) })).filter(g => g.items.length);
  gallery.innerHTML = groups.map(({ c, items }) => `
    <section class="tp-group" aria-labelledby="group-${c.id}">
      <div class="tp-group__head"><h2 id="group-${c.id}">${esc(c.name[state.lang])}</h2><span>${esc(t("count")(items.length))}</span></div>
      <ul class="tp-grid" role="list">
        ${items.map((x, i) => `<li class="tp-card" style="--i:${i}">
          <a class="tp-card__link" href="#${x.id}" data-open="${x.id}">
            <span class="tp-card__media"><img src="${x.thumb}" alt="" loading="lazy" decoding="async" /><span class="tp-card__view">${esc(t("view"))}</span></span>
            <span class="tp-card__body"><strong>${esc(x.name[state.lang])}</strong><span>${esc(x.blurb[state.lang])}</span></span>
          </a>
        </li>`).join("")}
      </ul>
    </section>`).join("");
}

function render() { applyLang(); renderFilters(); if (state.ready) renderGallery(); syncViewer(); }

/* ---------- Viewer: the sample invitation, full screen on phones, in a phone frame on wide screens ---------- */
let lastFocus = null;
function syncViewer() {
  const id = decodeURIComponent(location.hash.slice(1));
  const item = state.ready ? visibleTemplates(state.settings).find(x => x.id === id) : null;
  const viewer = $("viewer"), frame = $("viewerFrame");
  if (!item) {
    if (!viewer.hidden) {
      viewer.hidden = true; frame.src = "about:blank"; document.body.classList.remove("tp-locked");
      lastFocus?.focus?.();
    }
    return;
  }
  const name = item.name[state.lang];
  $("viewerTitle").textContent = name;
  frame.title = name;
  const want = whatsappLink(state.settings.whatsapp, item.name.en);
  $("viewerWant").hidden = !want;
  if (want) $("viewerWant").href = want;
  if (viewer.hidden) {
    lastFocus = document.activeElement;
    // Open the invitation in the visitor's language.
    setInvitationLanguage(item.id, state.lang);
    frame.src = item.url;
    viewer.hidden = false; document.body.classList.add("tp-locked");
    $("viewerClose").focus();
  }
}
// Each design remembers its own language; set it so the invitation opens in the visitor's language.
function setInvitationLanguage(id, lang) {
  try {
    if (id === "petit-nuage") sessionStorage.setItem("gender-reveal-language:petit-nuage", lang);
    else localStorage.setItem(id === "layla-zaid" ? "layla-zaid-invitation-language" : `${id}-language`, lang);
  } catch { /* storage may be blocked; the invitation then opens in English */ }
}
function closeViewer() {
  if (history.state?.tpViewer) history.back();
  else { history.replaceState(null, "", location.pathname + location.search); syncViewer(); }
}

$("gallery").addEventListener("click", event => {
  const link = event.target.closest("[data-open]");
  if (!link) return;
  event.preventDefault();
  history.pushState({ tpViewer: true }, "", `#${link.dataset.open}`);
  syncViewer();
});
$("filters").addEventListener("click", event => {
  const chip = event.target.closest("[data-filter]");
  if (!chip) return;
  state.filter = chip.dataset.filter;
  const url = new URL(location.href);
  if (state.filter) url.searchParams.set("event", state.filter); else url.searchParams.delete("event");
  history.replaceState(history.state, "", url);
  renderFilters(); renderGallery();
});
$("viewerClose").addEventListener("click", closeViewer);
document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("viewer").hidden) closeViewer(); });
window.addEventListener("popstate", syncViewer);
window.addEventListener("hashchange", syncViewer);
$("langToggle").addEventListener("click", () => {
  state.lang = state.lang === "ar" ? "en" : "ar";
  try { localStorage.setItem(LANG_KEY, state.lang); } catch { /* ignore */ }
  render();
});

/* ---------- Load which templates are hidden ---------- */
async function loadSettings() {
  try {
    const api = await import("./firebase-config.js");
    if (!api.isFirebaseConfigured()) return {};
    const { db } = api.initPublicFirebase();
    // Don't keep customers waiting on a slow connection: after 6 s show every template.
    const snap = await Promise.race([
      api.getDoc(api.doc(db, ...SHOWCASE_SETTINGS_PATH)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 6000))
    ]);
    return snap.exists() ? snap.data() : {};
  } catch (error) {
    console.warn("Template settings could not load; showing every template.", error);
    return {};
  }
}

render();
loadSettings().then(data => {
  state.settings = normalizeShowcaseSettings(data);
  state.ready = true;
  render();
});

export { SHOWCASE_TEMPLATES };
