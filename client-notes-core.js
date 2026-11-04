// Pure helpers for the client notes timeline: validation, ordering, search and markup.
// Money is integer fils; every piece of user text is escaped before it becomes HTML.
import { esc } from "./admin-api.js";
import { formatAed, parseAedToFils } from "./admin-money.js";

export const NOTE_MAX_TEXT = 5000, MAX_INTERESTS = 10, MAX_INTEREST_LEN = 40, NOTES_PAGE = 30, MAX_AUTHOR_NAME = 80;
export const INTEREST_SUGGESTIONS = Object.freeze(["Invitation", "Photo Bucket", "Seating", "Gender reveal", "Demo"]);

export const msOf = value => value?.toMillis?.() ?? (typeof value?.seconds === "number" ? value.seconds * 1000 : Number(value) || 0);

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : (parts[0] || "?").slice(0, 2)).toUpperCase();
}

export function relativeTime(ms, now = Date.now()) {
  if (!ms) return "just now";
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
export const exactTime = ms => ms ? new Date(ms).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }) : "";

export function normalizeInterest(text) { return Array.from(String(text ?? "").trim().replace(/\s+/g, " ")).slice(0, MAX_INTEREST_LEN).join(""); }
export function addInterest(list, text) {
  const value = normalizeInterest(text);
  if (!value || list.length >= MAX_INTERESTS || list.some(item => item.toLowerCase() === value.toLowerCase())) return list;
  return [...list, value];
}

// Returns { ok, errors, data }. data has exactly the fields the rules allow; priceFils and currency appear together or not at all.
export function buildNoteData({ text, priceText = "", interests = [], pinned = false, authorUid, authorName }) {
  const errors = {};
  const body = String(text ?? "").trim();
  if (!body) errors.text = "Write what you discussed.";
  else if (Array.from(body).length > NOTE_MAX_TEXT) errors.text = `Keep the note under ${NOTE_MAX_TEXT} characters.`;
  const priceClean = String(priceText ?? "").trim();
  const priceFils = priceClean === "" ? null : parseAedToFils(priceClean);
  if (priceClean !== "" && priceFils === null) errors.price = "Enter the price as dirhams, for example 4500 or 4500.50.";
  if (interests.length > MAX_INTERESTS) errors.interests = `Use at most ${MAX_INTERESTS} interests.`;
  const data = { text: body, interests: interests.slice(0, MAX_INTERESTS).map(normalizeInterest).filter(Boolean), pinned: Boolean(pinned), authorUid, authorName: Array.from(String(authorName || "Admin")).slice(0, MAX_AUTHOR_NAME).join("") };
  if (priceFils !== null) { data.priceFils = priceFils; data.currency = "AED"; }
  return { ok: Object.keys(errors).length === 0, errors, data };
}

// Pinned notes first, then newest first. Ties keep a stable order by id.
export const sortNotes = notes => [...notes].sort((a, b) => (b.pinned === true) - (a.pinned === true) || msOf(b.createdAt) - msOf(a.createdAt) || String(a.id).localeCompare(String(b.id)));
export function noteMatches(note, term = "", interest = "") {
  const t = term.trim().toLowerCase();
  return (!interest || (note.interests || []).some(i => i.toLowerCase() === interest.toLowerCase()))
    && (!t || `${note.text} ${(note.interests || []).join(" ")} ${note.authorName || ""}`.toLowerCase().includes(t));
}
export const isEdited = note => msOf(note.updatedAt) - msOf(note.createdAt) > 2000;
export const snippet = (text, max = 80) => { const flat = String(text ?? "").replace(/\s+/g, " ").trim(); const chars = Array.from(flat); return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : flat; };

export function noteBubbleHtml(note, now = Date.now()) {
  const created = msOf(note.createdAt), id = esc(note.id);
  return `<li class="note${note.pinned ? " note--pinned" : ""}" data-note="${id}"><span class="note__avatar" aria-hidden="true">${esc(initials(note.authorName))}</span><div class="note__bubble">
    <div class="note__meta"><strong dir="auto">${esc(note.authorName || "Admin")}</strong><time title="${esc(exactTime(created))}" datetime="${created ? esc(new Date(created).toISOString()) : ""}">${esc(relativeTime(created, now))}</time>${isEdited(note) ? `<span class="note__edited">edited</span>` : ""}${note.pinned ? `<span class="note__pin">Pinned</span>` : ""}</div>
    <p class="note__text" dir="auto">${esc(note.text)}</p>
    ${Number.isInteger(note.priceFils) || (note.interests || []).length ? `<div class="note__tags">${Number.isInteger(note.priceFils) ? `<span class="note__price">${esc(formatAed(note.priceFils))}</span>` : ""}${(note.interests || []).map(i => `<button class="chip chip--small" dir="auto" type="button" data-interest="${esc(i)}" aria-label="Filter notes by ${esc(i)}">${esc(i)}</button>`).join("")}</div>` : ""}
    <div class="note__actions"><button type="button" data-note-action="pin" data-id="${id}" aria-pressed="${note.pinned ? "true" : "false"}">${note.pinned ? "Unpin" : "Pin"}</button><button type="button" data-note-action="edit" data-id="${id}">Edit</button><button type="button" data-note-action="delete" data-id="${id}" class="note__danger">Delete</button></div></div></li>`;
}
