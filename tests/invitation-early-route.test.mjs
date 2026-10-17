import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("mapped invitation routes happen before body paint and retain search and hash", async () => {
  const [source, html, loginHtml, registry] = await Promise.all([
    readFile(new URL("../invitation-early-route.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../dashboard-login.html", import.meta.url), "utf8"),
    readFile(new URL("../invitations/wedding-designs/registry.js", import.meta.url), "utf8"),
  ]);
  const bodyOffset = html.indexOf("<body");
  const earlyScriptOffset = html.indexOf("invitation-early-route.js");
  assert.ok(earlyScriptOffset >= 0 && earlyScriptOffset < bodyOffset);
  const loginBodyOffset = loginHtml.indexOf("<body");
  const loginEarlyScriptOffset = loginHtml.indexOf("invitation-early-route.js");
  assert.ok(loginEarlyScriptOffset >= 0 && loginEarlyScriptOffset < loginBodyOffset);

  const original = new URL(
    "https://wedding-invitation-nlsf.vercel.app/index.html?wedding=luxury-wedding-demo#guest=synthetic-token&recipient=guest-a",
  );
  let redirectedTo = "";
  const window = {
    location: {
      search: original.search,
      hash: original.hash,
      href: original.href,
      replace(url) { redirectedTo = url; },
    },
  };
  const document = { documentElement: { style: {} } };

  runInNewContext(source, { window, document, URL, URLSearchParams });

  const target = new URL(redirectedTo);
  assert.equal(target.pathname, "/invitations/wedding-designs/layla-zaid/index.html");
  assert.equal(target.search, original.search);
  assert.equal(target.hash, original.hash);
  assert.equal(document.documentElement.style.visibility, "hidden");
  assert.match(registry, /"luxury-wedding-demo"[\s\S]*?route:\s*"\.\/invitations\/wedding-designs\/layla-zaid\/index\.html"/);
  assert.match(registry, /"M1S1aBL9134GSAozWh6G"[\s\S]*?route:\s*"\.\/invitations\/wedding-designs\/ali-salma\/index\.html"/);
});

test("unmapped weddings keep the original invitation page visible", async () => {
  const source = await readFile(new URL("../invitation-early-route.js", import.meta.url), "utf8");
  const original = new URL("https://wedding-invitation-nlsf.vercel.app/index.html?wedding=unmapped");
  let redirectedTo = "";
  const window = {
    location: {
      search: original.search,
      hash: original.hash,
      href: original.href,
      replace(url) { redirectedTo = url; },
    },
  };
  const document = { documentElement: { style: {} } };

  runInNewContext(source, { window, document, URL, URLSearchParams });

  assert.equal(redirectedTo, "");
  assert.equal(document.documentElement.style.visibility, undefined);
});

test("planner login preserves session-required routing but routes personal invitations before paint", async () => {
  const source = await readFile(new URL("../invitation-early-route.js", import.meta.url), "utf8");
  for (const hash of ["", "#session-required"]) {
    const original = new URL(`https://wedding-invitation-nlsf.vercel.app/dashboard-login.html?wedding=luxury-wedding-demo${hash}`);
    let redirectedTo = "";
    const window = {
      location: {
        search: original.search,
        hash: original.hash,
        href: original.href,
        replace(url) { redirectedTo = url; },
      },
    };
    const document = { documentElement: { style: {} } };
    runInNewContext(source, { window, document, URL, URLSearchParams });
    assert.equal(redirectedTo, "");
    assert.equal(document.documentElement.style.visibility, undefined);
  }

  const original = new URL(
    "https://wedding-invitation-nlsf.vercel.app/dashboard-login.html?wedding=luxury-wedding-demo#guest=synthetic-token&recipient=guest-a",
  );
  let redirectedTo = "";
  const window = {
    location: {
      search: original.search,
      hash: original.hash,
      href: original.href,
      replace(url) { redirectedTo = url; },
    },
  };
  const document = { documentElement: { style: {} } };
  runInNewContext(source, { window, document, URL, URLSearchParams });
  assert.equal(new URL(redirectedTo).hash, original.hash);
  assert.equal(document.documentElement.style.visibility, "hidden");
});

test("login and authenticated workspace routes cannot become invitation entry points", async () => {
  const source = await readFile(new URL("../invitation-early-route.js", import.meta.url), "utf8");
  for (const route of ["customer-login.html?wedding=luxury-wedding-demo&message=signed-out", "dashboard-login.html?wedding=luxury-wedding-demo&message=signed-out", "customer-events.html?wedding=luxury-wedding-demo", "all-events.html?wedding=luxury-wedding-demo", "dashboard.html?wedding=luxury-wedding-demo"]) {
    for (const hash of ["", "#guest=synthetic-only&recipient=g"]) {
      const original = new URL(`https://example.test/${route}${hash}`);
      let destination = "";
      const window = { location: { search: original.search, hash: original.hash, href: original.href, replace(value) { destination = value; } } };
      const document = { documentElement: { style: {} } };
      runInNewContext(source, { window, document, URL, URLSearchParams });
      assert.equal(destination, "", route);
    }
  }
});
