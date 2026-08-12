// Sender links must be portable across browsers and messaging apps. Encode the
// JSON as UTF-8 bytes first; btoa/atob only ever receive byte strings, never
// JavaScript Unicode text.
export function encodeUtf8Base64Url(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeUtf8Base64Url(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  // Reject malformed bytes instead of silently substituting replacement text.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function encodeSenderPayload(payload) {
  return encodeUtf8Base64Url(JSON.stringify(payload));
}

export function createSenderPayload({ weddingId, coupleName, side, guests }) {
  return {
    v: 1,
    w: weddingId || "",
    c: coupleName || "",
    side: side || "all",
    g: (guests || []).map((guest) => ({
      n: guest.fullName || "",
      p: guest.phone || "",
      s: guest.side || "",
      t: guest.guestToken || "",
    })),
  };
}

export function decodeSenderPayload(encodedPayload) {
  const parsed = JSON.parse(decodeUtf8Base64Url(encodedPayload));
  if (!parsed || !Array.isArray(parsed.g)) {
    throw new Error("Sender payload has no guest list.");
  }
  return parsed;
}

export function isIrrecoverablyCorruptedText(value) {
  const text = String(value ?? "").trim();
  return !text || /^[?\uFF1F\uFFFD\s]+$/u.test(text);
}

export function senderGuestPresentation(guest) {
  const englishName = isIrrecoverablyCorruptedText(guest?.n)
    ? ""
    : String(guest.n).trim();
  return {
    displayName: englishName || "Guest",
  };
}

export function buildSenderWhatsAppMessage(payload, guest, inviteLink) {
  const names = senderGuestPresentation(guest);
  const couple = payload?.c || "our wedding";
  return [
    `Wedding invitation â€” ${couple}`,
    `Hello ${names.displayName}! We would be honored to have you at our wedding. All the details and RSVP are here:`,
    inviteLink,
  ].join("\n\n");
}
