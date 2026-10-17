import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("root routing carries invitation hash credentials to the design page", async () => {
  const source = await readFile(new URL("../invitations/router.js", import.meta.url), "utf8");
  const executable = source.replace(/^import\s+\{[^}]+\}\s+from\s+"[^"]+";\s*/m, "");
  const original = new URL(
    "https://wedding-invitation-nlsf.vercel.app/index.html?wedding=event-a#guest=synthetic-token&recipient=guest-a",
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

  runInNewContext(executable, {
    window,
    URL,
    URLSearchParams,
    getInvitationRoute: (_eventId, baseUrl) => new URL("./invitations/wedding-designs/layla-zaid/index.html", baseUrl),
  });

  const target = new URL(redirectedTo);
  assert.equal(target.pathname, "/invitations/wedding-designs/layla-zaid/index.html");
  assert.equal(target.searchParams.get("wedding"), "event-a");
  assert.equal(new URLSearchParams(target.hash.slice(1)).get("guest"), "synthetic-token");
  assert.equal(new URLSearchParams(target.hash.slice(1)).get("recipient"), "guest-a");
});
