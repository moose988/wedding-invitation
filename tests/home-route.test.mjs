import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../home-route.js", import.meta.url), "utf8");

function redirectFor(href) {
  const url = new URL(href);
  let destination = "";
  const window = {
    location: {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      replace(value) {
        destination = value;
      },
    },
  };

  runInNewContext(source, { window, URLSearchParams });
  return destination;
}

test("plain root and index entry open customer login before invitation content paints", () => {
  assert.equal(redirectFor("https://events.qdsystems.ae/"), "./customer-login.html");
  assert.equal(redirectFor("https://events.qdsystems.ae/index.html"), "./customer-login.html");
});

test("root login redirect keeps unrelated login or campaign parameters intact", () => {
  assert.equal(
    redirectFor("https://events.qdsystems.ae/?message=signed-out&utm_source=qd#continue"),
    "./customer-login.html?message=signed-out&utm_source=qd#continue",
  );
});

test("invitation query keys are preserved even when values are incomplete or invalid", () => {
  for (const suffix of [
    "?wedding=event-42#guest=token-42&recipient=guest-7",
    "?wedding=unknown-event",
    "?wedding=",
    "?guest=token-42",
    "?recipient=guest-7",
    "?sample=1",
    "?sample=1&wedding=wrong-sample",
  ]) {
    assert.equal(redirectFor(`https://events.qdsystems.ae/${suffix}`), "", suffix);
  }
});

test("supported invitation hashes and the existing explicit demo route stay at root", () => {
  for (const suffix of ["#guest=token-42&recipient=guest-7", "#guest=", "#recipient=guest-7", "?demo=1"]) {
    assert.equal(redirectFor(`https://events.qdsystems.ae/${suffix}`), "", suffix);
  }
});

test("non-root app routes are not rewritten", () => {
  assert.equal(
    redirectFor("https://events.qdsystems.ae/dashboard.html?wedding=event-42"),
    "",
  );
});
