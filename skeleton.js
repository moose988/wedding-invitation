// Markup for the shared skeleton style (skeleton.css). Static strings only: no user text goes in.
const wrap = (label, inner, cls = "sk-list") => `<div class="${cls}" role="status" aria-busy="true"><span class="sr-only">${label}</span>${inner}</div>`;
const repeat = (n, html) => Array.from({ length: n }, () => html).join("");
const line = (cls = "") => `<span class="sk-line ${cls}"></span>`;

export const skeleton = {
  // Cards like an event, bucket or customer item: type pill and date, a title, one button.
  cards: (n = 3, label = "Loading…") => wrap(label, repeat(n, `<div class="sk-card"><div class="sk-card__top"><span class="sk-pill"></span>${line("sk-line--short")}</div>${line("sk-line--title")}${line("sk-line--mid")}<span class="sk-btn"></span></div>`), "sk-grid"),
  // List rows like a customer, client, demo or log entry: avatar and two lines.
  rows: (n = 4, label = "Loading…") => wrap(label, repeat(n, `<div class="sk-row"><span class="sk-row__avatar sk sk-pill"></span><span class="sk-row__text">${line("sk-line--mid")}${line("sk-line--short")}</span></div>`)),
  // Gallery tiles: image area, name and time.
  tiles: (n = 6, label = "Loading photos…") => wrap(label, repeat(n, `<div class="sk-tile"><span class="sk-tile__img"></span><div class="sk-tile__body">${line("sk-line--mid")}${line("sk-line--short")}</div></div>`), "sk-grid sk-grid--tiles"),
  // A block of text lines, for a detail page or a dialog body.
  lines: (n = 4, label = "Loading…") => wrap(label, Array.from({ length: n }, (_, i) => line(i % 3 === 2 ? "sk-line--short" : i % 3 === 1 ? "sk-line--mid" : "")).join("")),
};
export const busyNote = (text) => `<p class="sk-busy" role="status">${text}</p>`;
