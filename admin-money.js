// Money for the Clients page and quotations. Every amount is an integer number of
// fils (1 AED = 100 fils). Floats are never stored; text typed by a person is
// parsed with a strict pattern and never through Number() or parseFloat().
export const MAX_QUOTE_LINES = 50;
export const MAX_FILS = 99_999_999_999; // far below Number.MAX_SAFE_INTEGER
export const VAT_PERCENT = 5;
export const MAX_DESCRIPTION = 500;
export const MAX_QUANTITY = 99_999;

// "1250", "1,250.5" and "0.05" are accepted. "1.234", "-5" and "1e3" are not.
export function parseAedToFils(text) {
  const clean = String(text ?? "").trim().replace(/,/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(clean);
  if (!match) return null;
  const fils = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0") || 0);
  return Number.isSafeInteger(fils) && fils <= MAX_FILS ? fils : null;
}

export function formatAed(fils) {
  if (!Number.isInteger(fils)) return "";
  const sign = fils < 0 ? "-" : "";
  const abs = Math.abs(fils);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}AED ${whole}.${String(abs % 100).padStart(2, "0")}`;
}

// The same figure without the currency, for editing in an input.
export function filsToInput(fils) {
  return Number.isInteger(fils) && fils >= 0 ? `${Math.floor(fils / 100)}.${String(fils % 100).padStart(2, "0")}` : "";
}

// 5% of an integer, rounded half up, using integers only.
export function vatOn(fils) {
  return Math.floor((fils * VAT_PERCENT + 50) / 100);
}

// Returns { ok, errors: [{ index, field, message }] } and checks EVERY line, because
// the Firestore rules can only check the first ten.
export function validateLines(lines) {
  const errors = [];
  if (!Array.isArray(lines) || lines.length === 0) errors.push({ index: -1, field: "lines", message: "Add at least one line." });
  else if (lines.length > MAX_QUOTE_LINES) errors.push({ index: -1, field: "lines", message: `A quotation can have at most ${MAX_QUOTE_LINES} lines.` });
  (Array.isArray(lines) ? lines : []).forEach((line, index) => {
    const description = String(line?.description ?? "").trim();
    if (!description) errors.push({ index, field: "description", message: "Describe this item." });
    else if (Array.from(description).length > MAX_DESCRIPTION) errors.push({ index, field: "description", message: `Keep it under ${MAX_DESCRIPTION} characters.` });
    if (!Number.isInteger(line?.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) errors.push({ index, field: "quantity", message: `Quantity is a whole number from 1 to ${MAX_QUANTITY}.` });
    if (!Number.isInteger(line?.unitPriceFils) || line.unitPriceFils < 0 || line.unitPriceFils > MAX_FILS) errors.push({ index, field: "unitPrice", message: "Enter a price such as 1500 or 1500.50." });
    else if (Number.isInteger(line.quantity) && !Number.isSafeInteger(line.quantity * line.unitPriceFils)) errors.push({ index, field: "unitPrice", message: "This line total is too large." });
  });
  return { ok: errors.length === 0, errors };
}

// Totals in fils. The discount is capped so the total can never go negative.
export function computeTotals(lineItems, { discountFils = 0, vat = false } = {}) {
  const subtotalFils = lineItems.reduce((sum, line) => sum + line.quantity * line.unitPriceFils, 0);
  const discount = Math.min(Math.max(Number.isInteger(discountFils) ? discountFils : 0, 0), subtotalFils);
  const vatFils = vat ? vatOn(subtotalFils - discount) : 0;
  return { subtotalFils, discountFils: discount, vatFils, totalFils: subtotalFils - discount + vatFils };
}

// The exact shape the Firestore rules accept (4 keys per line, 4 totals).
export function buildLineItems(lines) {
  return lines.map(({ description, quantity, unitPriceFils }) => ({
    description: String(description).trim(), quantity, unitPriceFils, totalFils: quantity * unitPriceFils,
  }));
}

export function formatQuoteNumber(date = new Date(), sequence = 1) {
  return `QD-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}-${String(sequence).padStart(3, "0")}`;
}

// Plain-English draft for the owner to review. The bracketed parts are
// deliberately left blank: they are decisions and legal wording that only the
// owner can supply. Nothing here states a company registration or a legal claim.
export const DEFAULT_TERMS = [
  "Photo buckets are deleted 48 hours after the event. Please download your photos before then.",
  "",
  "Payment: [OWNER TO COMPLETE: deposit, balance and due dates.]",
  "Cancellation: [OWNER TO COMPLETE: what happens if the booking is cancelled or moved.]",
  "Liability: [OWNER TO COMPLETE: limits of responsibility. Check this wording with a legal adviser.]",
  "The customer confirms they hold the rights to any music they provide.",
  "",
  "This quotation is valid until the date shown above. Prices are in UAE dirhams (AED).",
].join("\n");

export const MUSIC_RIGHTS_TERM = "The customer confirms they hold the rights to any music they provide.";
export const PHOTO_BUCKET_TERM = "Photo buckets are deleted 48 hours after the event. Please download your photos before then.";
export const COMPANY = Object.freeze({ name: "QD Systems", phone: "+971504611123", currency: "AED" });
