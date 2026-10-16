import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
const hosting = config.hosting;

test("Firebase Hosting source config defines the required security headers", () => {
  const globalHeaders = hosting.headers.find((entry) => entry.source === "**")?.headers || [];
  const htmlHeaders = hosting.headers.find((entry) => entry.source === "**/*.html")?.headers || [];
  const values = Object.fromEntries(globalHeaders.map(({ key, value }) => [key.toLowerCase(), value]));

  assert.match(values["content-security-policy"] || "", /frame-ancestors 'none'/);
  assert.match(values["content-security-policy"] || "", /object-src 'none'/);
  assert.match(values["content-security-policy"] || "", /upgrade-insecure-requests/);
  assert.equal(values["referrer-policy"], "no-referrer");
  assert.equal(values["x-content-type-options"], "nosniff");
  assert.equal(values["x-frame-options"], "DENY");
  assert.ok(htmlHeaders.some(({ key, value }) => key.toLowerCase() === "cache-control" && /no-store/i.test(value)));
});

test("deployed Firebase Hosting serves headers on private application pages", {
  skip: process.env.HOSTING_SECURITY_TEST_URL ? false : "Set HOSTING_SECURITY_TEST_URL to a deployed site to run this release gate.",
}, async () => {
  const siteUrl = process.env.HOSTING_SECURITY_TEST_URL;
  const pages = ["/index.html", "/dashboard.html", "/side.html", "/invitations/wedding-designs/layla-zaid/index.html"];
  for (const path of pages) {
    const response = await fetch(new URL(path, siteUrl), { redirect: "manual" });
    assert.equal(response.status, 200, `${path} should be served by Hosting`);
    assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
    assert.match(response.headers.get("cache-control") || "", /no-store/i, `${path} must not be cached`);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer", `${path} must not disclose invitation URLs`);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", `${path} must prevent MIME sniffing`);
    assert.equal(response.headers.get("x-frame-options"), "DENY", `${path} must not be framed`);
  }
});
