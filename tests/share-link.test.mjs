import test from "node:test";
import assert from "node:assert/strict";
import { createShareUrl, PUBLIC_SHARE_ORIGIN } from "../share-link.js";

test("Vercel preview share URLs use the stable public origin", () => {
  const url = createShareUrl(
    "index.html",
    "https://wedding-invitation-nlsf-git-main-moose988s-projects.vercel.app/dashboard.html?wedding=event-a",
  );
  url.searchParams.set("wedding", "event-a");
  url.hash = new URLSearchParams({ guest: "A".repeat(43), recipient: "guest-1" }).toString();

  assert.equal(url.origin, PUBLIC_SHARE_ORIGIN);
  assert.equal(url.pathname, "/index.html");
  assert.equal(url.searchParams.get("wedding"), "event-a");
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("guest"), "A".repeat(43));
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("recipient"), "guest-1");
});

test("stable production, local, Firebase Hosting, and custom origins stay unchanged", () => {
  const sources = [
    "https://wedding-invitation-nlsf.vercel.app/dashboard.html?wedding=event-a",
    "http://127.0.0.1:8000/dashboard.html?wedding=event-a",
    "https://weddinginvitaion-b4f36.web.app/dashboard.html?wedding=event-a",
    "https://invites.example.test/dashboard.html?wedding=event-a",
  ];

  for (const source of sources) {
    assert.equal(createShareUrl("index.html", source).origin, new URL(source).origin);
  }
});

test("non-preview lookalike domains are not rewritten", () => {
  const url = createShareUrl(
    "index.html",
    "https://wedding-invitation-nlsf-git-main.example.net/dashboard.html",
  );
  assert.equal(url.origin, "https://wedding-invitation-nlsf-git-main.example.net");
});
