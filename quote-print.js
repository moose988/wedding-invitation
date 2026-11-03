// Printable quotation markup. Every value is escaped before it becomes HTML.
import { esc } from "./admin-api.js";
import { COMPANY, formatAed } from "./admin-money.js";

const fmtDate = d => d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
export function quoteHtml(v) {
  const t = v.totals;
  return `<article class="quote-sheet"><header class="quote-sheet__head"><div><p class="quote-sheet__brand">${esc(COMPANY.name)}</p><p>${esc(COMPANY.phone)}</p></div><div class="quote-sheet__meta"><h1>Quotation</h1><p>No. ${esc(v.number)}</p><p>Date: ${esc(fmtDate(v.date))}</p>${v.validUntil ? `<p>Valid until: ${esc(fmtDate(v.validUntil))}</p>` : ""}</div></header>
    <section class="quote-sheet__to"><h2>Prepared for</h2><p><strong>${esc(v.client?.name)}</strong></p>${v.client?.phone ? `<p>${esc(v.client.phone)}</p>` : ""}${v.client?.email ? `<p>${esc(v.client.email)}</p>` : ""}</section>
    <table class="quote-sheet__table"><thead><tr><th scope="col">Description</th><th scope="col" class="num">Qty</th><th scope="col" class="num">Unit price</th><th scope="col" class="num">Amount</th></tr></thead><tbody>${v.lineItems.map(l => `<tr><td>${esc(l.description)}</td><td class="num">${esc(l.quantity)}</td><td class="num">${esc(formatAed(l.unitPriceFils))}</td><td class="num">${esc(formatAed(l.totalFils))}</td></tr>`).join("")}</tbody></table>
    <dl class="quote-sheet__totals"><div><dt>Subtotal</dt><dd>${esc(formatAed(t.subtotalFils))}</dd></div>${t.discountFils ? `<div><dt>Discount</dt><dd>- ${esc(formatAed(t.discountFils))}</dd></div>` : ""}${t.vatFils ? `<div><dt>VAT (5%)</dt><dd>${esc(formatAed(t.vatFils))}</dd></div>` : ""}<div class="grand"><dt>Total (AED)</dt><dd>${esc(formatAed(t.totalFils))}</dd></div></dl>
    <section class="quote-sheet__terms"><h2>Terms and conditions</h2><p>${esc(v.terms).replace(/\n/g, "<br>")}</p></section></article>`;
}
