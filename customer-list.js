// One list for everything a customer can open: events (invitations) and photo buckets together.
// Pure helpers, so the order and the markup are easy to test. All text is escaped here.
import { esc } from "./admin-api.js";

export const CUSTOMER_ADMIN_REDIRECT = "./customer-events.html?message=admin-only";

const DAY = 86_400_000;
export const startOfToday = (now = Date.now()) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };

// A bucket's date is a calendar day; treat it as that day in local time.
export function dayMs(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0;
}

// Nearest upcoming first (today counts as upcoming), then past items, most recent first,
// then items with no date. Equal dates fall back to the name so the order never jumps.
export function sortCustomerItems(items, now = Date.now()) {
  const today = startOfToday(now);
  const group = item => !item.ms ? 2 : item.ms >= today ? 0 : 1;
  return [...items].sort((a, b) => group(a) - group(b)
    || (group(a) === 0 ? a.ms - b.ms : group(a) === 1 ? b.ms - a.ms : 0)
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export const eventItem = (w, { name, dateText, ms }) => ({ kind: "event", id: w.id, name, typeLabel: "Invitation", dateText, ms, seatingOnly: w.seatingOnly === true });
export const bucketItem = (b, dateText) => ({ kind: "bucket", id: b.id, name: b.name || "Photo Bucket", typeLabel: "Photo Bucket", dateText, ms: dayMs(b.date) });

export function itemCardHtml(item) {
  const id = esc(item.id), name = esc(item.name);
  const action = item.kind === "bucket"
    ? `<a class="primary-button customer-item__action" href="./photo-bucket-manage.html?bucket=${encodeURIComponent(item.id)}">Open photos<span class="sr-only"> for ${name}</span></a>`
    : `<button class="primary-button customer-item__action" data-action="open" data-id="${id}" type="button">${item.seatingOnly ? "Open seating" : "Open event"}<span class="sr-only"> ${name}</span></button>`;
  return `<article class="customer-item customer-item--${item.kind}"><div class="customer-item__top"><span class="customer-item__type">${esc(item.typeLabel)}</span><span class="customer-item__date">${esc(item.dateText || "Date to be set")}</span></div><h2 class="customer-item__name" dir="auto">${name}</h2>${action}</article>`;
}

// problems: [{ text, retry }] where retry is a data attribute value for a Try again button.
export function noticesHtml(problems) {
  return problems.map(p => `<div class="customer-notice" role="alert"><p>${esc(p.text)}</p><button class="secondary-button" type="button" data-retry="${esc(p.retry)}">Try again</button></div>`).join("");
}
