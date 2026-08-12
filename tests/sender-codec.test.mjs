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
    guests: [
      {
        fullName: guest.n,
        phone: guest.p,
        side: guest.s,
        guestToken: guest.t,
        legacyName: guest.legacyName,
      },
    ],
  });
  const link = `send.html#data=${encodeSenderPayload(payload)}`;
  const encoded = new URL(`https://example.test/${link}`).hash.slice(6);
  return { payload: decodeSenderPayload(encoded), link };
}

test("sender workflow keeps names and excludes unsupported guest fields", () => {
  const guests = [
    { n: "Amal Kareem", p: "971500000001", s: "bride", t: "one", legacyName: "ignored" },
    { n: "Mona Al-Hassan", p: "971500000002", s: "groom", t: "two", legacyName: "ignored" },
    { n: "Rana 🎉", p: "971500000003", s: "family", t: "three", legacyName: "ignored" },
    { n: "D'Angelo & Co.", p: "971500000004", s: "both", t: "four", legacyName: "ignored" },
  ];

  guests.forEach((guest) => {
    const { payload } = roundTripGuest(guest);
    assert.equal(payload.g[0].legacyName, undefined);
    assert.equal(payload.g[0].n, guest.n);
    assert.equal(senderGuestPresentation(payload.g[0]).displayName, guest.n);
    const message = buildSenderWhatsAppMessage(
      payload,
      payload.g[0],
      "https://example.test/invite",
    );
    assert.match(
      message,
      new RegExp(guest.n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"),
    );
  });
});
