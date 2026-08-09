import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSenderWhatsAppMessage,
  createSenderPayload,
  decodeSenderPayload,
  encodeSenderPayload,
  senderGuestPresentation,
} from "../sender-codec.mjs";

function roundTripGuest(guest) {
  const payload = createSenderPayload({
    weddingId: "wedding-test",
    coupleName: "Layla & Zaid",
    side: "all",
    guests: [{ fullName: guest.n, fullNameAr: guest.a, phone: guest.p, side: guest.s, guestToken: guest.t }],
  });
  const link = `send.html#data=${encodeSenderPayload(payload)}`;
  const encoded = new URL(`https://example.test/${link}`).hash.slice(6);
  return { payload: decodeSenderPayload(encoded), link };
}

test("sender workflow keeps English, emoji, and special characters without Arabic sender text", () => {
  const guests = [
    { n: "Amal Kareem", a: "أمل كريم", p: "971500000001", s: "bride", t: "arabic" },
    { n: "Mona Al-Hassan", a: "منى Al-Hassan", p: "971500000002", s: "groom", t: "mixed" },
    { n: "Rana 🎉", a: "رانا 🎉", p: "971500000003", s: "family", t: "emoji" },
    { n: "D'Angelo & Co.", a: "دانجيلو وشركاه", p: "971500000004", s: "both", t: "special" },
  ];
  guests.forEach((guest) => {
    const { payload } = roundTripGuest(guest);
    assert.equal(payload.g[0].a, undefined);
    assert.equal(payload.g[0].n, guest.n);
    const presentation = senderGuestPresentation(payload.g[0]);
    assert.equal(presentation.displayName, guest.n);
    assert.equal(presentation.arabicName, "");
    const message = buildSenderWhatsAppMessage(payload, payload.g[0], "https://example.test/invite");
    assert.match(message, new RegExp(guest.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
  });
});

test("legacy sender payloads with irreversibly corrupted Arabic hide only that line", () => {
  const guest = { n: "Khaled Omar", a: "???? ???", p: "971504444444", s: "groom", t: "legacy" };
  const { payload } = roundTripGuest(guest);
  const presentation = senderGuestPresentation(payload.g[0]);
  assert.equal(presentation.displayName, "Khaled Omar");
  assert.equal(presentation.arabicName, "");
  const message = buildSenderWhatsAppMessage(payload, payload.g[0], "https://example.test/invite");
  assert.doesNotMatch(message, /\?{2,}/u);
  assert.match(message, /Khaled Omar/u);
});
