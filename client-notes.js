// Client notes timeline (admin only): chat-style bubbles, a compact composer, search and
// interest filters, pinning, and pages of 30. Data lives in clients/{id}/notes.
import { skeleton } from "./skeleton.js";
import { esc } from "./admin-api.js";
import { INTEREST_SUGGESTIONS, MAX_INTERESTS, NOTES_PAGE, addInterest, buildNoteData, noteBubbleHtml, noteMatches, snippet, sortNotes, msOf } from "./client-notes-core.js";

const $ = (root, sel) => root.querySelector(sel);
const authorName = user => user?.displayName || String(user?.email || "Admin").split("@")[0];
const notesRef = (api, db, clientId) => api.collection(db, "clients", clientId, "notes");

// Count and latest note for a clients-list row. Two cheap reads: an aggregate count and one document.
export async function loadNotesMeta(api, db, clientId) {
  const [count, latest] = await Promise.all([
    api.getCountFromServer(notesRef(api, db, clientId)),
    api.getDocs(api.query(notesRef(api, db, clientId), api.orderBy("createdAt", "desc"), api.limit(1))),
  ]);
  const doc = latest.docs[0];
  return { count: count.data().count, latest: doc ? snippet(doc.data().text, 90) : "" };
}

function dialog() {
  let d = document.getElementById("noteDialog");
  if (!d) { d = document.createElement("dialog"); d.id = "noteDialog"; d.className = "workspace-dialog note-dialog"; document.body.append(d); }
  return d;
}

// Opens the composer for a new note (note omitted) or to edit one. Calls onSaved(noteId) after a successful save.
export function openNoteComposer({ api, db, user, clientId, clientName = "", note = null, onSaved = () => {} }) {
  const d = dialog();
  let interests = [...(note?.interests || [])];
  d.innerHTML = `<form class="workspace-modal workspace-modal--small" novalidate><header><div><p class="workspace-kicker">${esc(clientName || "Client note")}</p><h2>${note ? "Edit note" : "New note"}</h2></div><button class="icon-close" type="button" data-close aria-label="Close">×</button></header>
    <div class="workspace-modal__body note-form">
      <label>What did you discuss?<textarea name="text" rows="5" maxlength="5000" required>${esc(note?.text || "")}</textarea></label>
      <label>Price discussed in AED (optional)<input name="price" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${Number.isInteger(note?.priceFils) ? esc(`${Math.floor(note.priceFils / 100)}.${String(note.priceFils % 100).padStart(2, "0")}`) : ""}" /></label>
      <div class="chips-field"><label for="interestInput">Interests <small>Type and press Enter. Up to ${MAX_INTERESTS}.</small></label><div class="chip-row" id="chipList" aria-live="polite"></div><input id="interestInput" maxlength="40" autocomplete="off" placeholder="For example: Invitation" /><div class="chip-row" id="suggestions" aria-label="Suggested interests"></div></div>
      <label class="check-row"><input type="checkbox" name="pinned" ${note?.pinned ? "checked" : ""} /> Pin this note to the top</label>
      <p class="form-error" role="alert"></p></div>
    <footer><button class="secondary-button" type="button" data-close>Cancel</button><button class="primary-button" type="submit">Save note</button></footer></form>`;
  const form = $(d, "form"), chips = $(d, "#chipList"), input = $(d, "#interestInput"), sugg = $(d, "#suggestions"), error = $(d, ".form-error");
  const paint = () => {
    chips.innerHTML = interests.map((i, n) => `<span class="chip">${esc(i)}<button type="button" data-chip-remove="${n}" aria-label="Remove ${esc(i)}">×</button></span>`).join("");
    sugg.innerHTML = INTEREST_SUGGESTIONS.filter(s => !interests.some(i => i.toLowerCase() === s.toLowerCase())).map(s => `<button class="chip chip--ghost" type="button" data-suggest="${esc(s)}">+ ${esc(s)}</button>`).join("");
  };
  const commit = () => { if (input.value.trim()) { interests = addInterest(interests, input.value); input.value = ""; paint(); } };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
    else if (e.key === "Backspace" && !input.value && interests.length) { interests = interests.slice(0, -1); paint(); }
  });
  form.addEventListener("click", e => {
    if (e.target.closest("[data-close]")) d.close();
    const r = e.target.closest("[data-chip-remove]"); if (r) { interests = interests.filter((_, n) => n !== Number(r.dataset.chipRemove)); paint(); input.focus(); }
    const s = e.target.closest("[data-suggest]"); if (s) { interests = addInterest(interests, s.dataset.suggest); paint(); }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); commit();
    const f = form.elements, built = buildNoteData({ text: f.text.value, priceText: f.price.value, interests, pinned: f.pinned.checked, authorUid: note?.authorUid || user.uid, authorName: note?.authorName || authorName(user) });
    if (!built.ok) { error.textContent = Object.values(built.errors)[0]; (built.errors.text ? f.text : f.price).focus(); return; }
    const save = $(form, '[type="submit"]'); save.disabled = true; error.textContent = "";
    try {
      const stamp = api.serverTimestamp();
      if (note) await api.setDoc(api.doc(notesRef(api, db, clientId), note.id), { ...built.data, createdAt: note.createdAt, updatedAt: stamp });
      else { const ref = await api.addDoc(notesRef(api, db, clientId), { ...built.data, createdAt: stamp, updatedAt: stamp }); note = { id: ref.id }; }
      d.close(); onSaved(note.id);
    } catch (failure) { error.textContent = `The note could not be saved: ${failure?.message || failure?.code || "try again"}.`; }
    finally { save.disabled = false; }
  });
  paint(); d.showModal(); $(form, "textarea").focus();
}

// The timeline inside a client's detail page.
export function mountNotes({ api, db, user, client, host }) {
  const s = { notes: [], cursor: null, more: false, term: "", interest: "", error: "", loading: true, pending: new Set() };
  host.innerHTML = `<section class="admin-card notes" aria-labelledby="notesTitle"><div class="admin-panel__head"><h2 id="notesTitle">Notes</h2><button class="primary-button note-new" type="button" data-note-new>New note</button></div>
    <div class="notes-tools"><label class="search-field"><span class="sr-only">Search notes</span><input type="search" data-note-search placeholder="Search notes" /></label><div class="chip-row" data-note-chips aria-label="Filter by interest"></div></div>
    <p class="workspace-status" role="status" data-note-status></p><div data-note-list></div><div class="load-more-row"><button class="secondary-button" type="button" data-note-more hidden>Load more notes</button></div></section>`;
  const list = $(host, "[data-note-list]"), status = $(host, "[data-note-status]"), more = $(host, "[data-note-more]"), chipsEl = $(host, "[data-note-chips]");
  const read = d => ({ id: d.id, ...d.data() });

  const paint = () => {
    if (s.loading) { list.innerHTML = skeleton.rows(3, "Loading notes…"); status.textContent = ""; more.hidden = true; return; }
    if (s.error) { list.innerHTML = `<div class="notes-empty" role="alert"><p>${esc(s.error)}</p><button class="secondary-button" type="button" data-note-retry>Try again</button></div>`; status.textContent = ""; more.hidden = true; return; }
    const interests = [...new Set(s.notes.flatMap(n => n.interests || []))].slice(0, 20);
    chipsEl.innerHTML = interests.map(i => `<button class="chip${s.interest.toLowerCase() === i.toLowerCase() ? " chip--on" : ""}" type="button" data-interest="${esc(i)}" aria-pressed="${s.interest.toLowerCase() === i.toLowerCase()}">${esc(i)}</button>`).join("");
    const shown = sortNotes(s.notes).filter(n => noteMatches(n, s.term, s.interest));
    if (!s.notes.length) list.innerHTML = `<div class="notes-empty"><strong>No notes yet.</strong><p>Add what you discussed.</p><button class="primary-button" type="button" data-note-new>New note</button></div>`;
    else if (!shown.length) list.innerHTML = `<div class="notes-empty"><strong>No notes match.</strong><p>Try another word or clear the interest filter.</p></div>`;
    else list.innerHTML = `<ol class="notes-list">${shown.map(n => noteBubbleHtml(n)).join("")}</ol>`;
    status.textContent = s.notes.length ? `${shown.length} of ${s.notes.length} note${s.notes.length === 1 ? "" : "s"} shown${s.more ? ". Search covers the notes loaded so far." : ""}` : "";
    more.hidden = !s.more;
  };

  async function load(reset = true) {
    if (reset) { s.loading = true; s.error = ""; s.cursor = null; paint(); }
    try {
      const coll = notesRef(api, db, client.id);
      const [page, pinned] = await Promise.all([
        api.getDocs(api.query(coll, api.orderBy("createdAt", "desc"), ...(!reset && s.cursor ? [api.startAfter(s.cursor)] : []), api.limit(NOTES_PAGE))),
        reset ? api.getDocs(api.query(coll, api.where("pinned", "==", true), api.limit(30))) : Promise.resolve({ docs: [] }),
      ]);
      const byId = new Map((reset ? [] : s.notes).map(n => [n.id, n]));
      for (const d of [...pinned.docs, ...page.docs]) byId.set(d.id, read(d));
      s.notes = [...byId.values()]; s.cursor = page.docs.at(-1) || s.cursor; s.more = page.docs.length === NOTES_PAGE; s.error = "";
    } catch (error) { s.error = `Notes could not load (${error?.code || error?.message || "network error"}).`; }
    s.loading = false; paint();
  }

  const rewrite = async (note, changes) => {
    s.pending.add(note.id);
    try {
      const built = buildNoteData({ text: note.text, priceText: Number.isInteger(note.priceFils) ? `${Math.floor(note.priceFils / 100)}.${String(note.priceFils % 100).padStart(2, "0")}` : "", interests: note.interests || [], pinned: note.pinned, authorUid: note.authorUid, authorName: note.authorName, ...changes });
      await api.setDoc(api.doc(notesRef(api, db, client.id), note.id), { ...built.data, createdAt: note.createdAt, updatedAt: api.serverTimestamp() });
      await load(true);
    } catch (error) { status.textContent = `The note could not be updated (${error?.code || "try again"}).`; }
    finally { s.pending.delete(note.id); }
  };

  function confirmDelete(note) {
    const d = dialog();
    d.innerHTML = `<form class="workspace-modal workspace-modal--small"><header><h2>Delete this note?</h2><button class="icon-close" type="button" data-close aria-label="Close">×</button></header><div class="workspace-modal__body"><p>This note is removed for everyone and cannot be brought back.</p><blockquote class="note-quote">${esc(snippet(note.text, 140))}</blockquote><p class="form-error" role="alert"></p></div><footer><button class="secondary-button" type="button" data-close>Keep note</button><button class="danger-button" type="submit">Delete note</button></footer></form>`;
    $(d, "form").addEventListener("click", e => { if (e.target.closest("[data-close]")) d.close(); });
    $(d, "form").addEventListener("submit", async e => {
      e.preventDefault(); const b = $(d, '[type="submit"]'); b.disabled = true;
      try { await api.deleteDoc(api.doc(notesRef(api, db, client.id), note.id)); d.close(); await load(true); }
      catch (error) { $(d, ".form-error").textContent = `Could not delete: ${error?.message || "try again"}.`; b.disabled = false; }
    });
    d.showModal();
  }

  host.addEventListener("click", e => {
    if (e.target.closest("[data-note-new]")) return openNoteComposer({ api, db, user, clientId: client.id, clientName: client.name, onSaved: () => load(true) });
    if (e.target.closest("[data-note-retry]")) return void load(true);
    if (e.target.closest("[data-note-more]")) return void load(false);
    const chip = e.target.closest("[data-interest]");
    if (chip) { s.interest = s.interest.toLowerCase() === chip.dataset.interest.toLowerCase() ? "" : chip.dataset.interest; return paint(); }
    const action = e.target.closest("[data-note-action]"); if (!action) return;
    const note = s.notes.find(n => n.id === action.dataset.id); if (!note || s.pending.has(note.id)) return;
    if (action.dataset.noteAction === "edit") openNoteComposer({ api, db, user, clientId: client.id, clientName: client.name, note, onSaved: () => load(true) });
    if (action.dataset.noteAction === "delete") confirmDelete(note);
    if (action.dataset.noteAction === "pin") void rewrite(note, { pinned: !note.pinned });
  });
  $(host, "[data-note-search]").addEventListener("input", e => { s.term = e.target.value; paint(); });
  void load(true);
  return { reload: () => load(true), newest: () => msOf(s.notes[0]?.createdAt) };
}
