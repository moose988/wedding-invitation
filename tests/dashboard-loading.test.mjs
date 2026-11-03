import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("the dashboard shows a skeleton from the first paint, with a slow-connection note and retry", async () => {
  const html = await read("dashboard.html");
  const loading = html.indexOf('id="dashboardLoading"'), app = html.indexOf('id="dashboardApp"');
  assert.ok(loading > 0 && loading < app, "placeholder comes before the app in the HTML");
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Loading your event…/);
  assert.match(html, /dash-loading__slow[\s\S]*href=""[\s\S]*Try again/);
  const css = await read("dashboard.css");
  assert.match(css, /animation: dash-loading-slow 0s linear 10s forwards/, "the slow note appears after 10 s without any script");
  assert.match(css, /:has\(> #dashboardApp:not\(\[hidden\]\)\) > \.dash-loading/);
});

test("every way the dashboard appears also removes the placeholder", async () => {
  const js = await read("dashboard.js");
  assert.equal((js.match(/elements\.dashboardApp\.hidden = false;/g) || []).length, 1, "only revealDashboard unhides the app");
  assert.match(js, /function revealDashboard\(\)[\s\S]*dashboardLoading[\s\S]*hidden = true/);
  for (const fn of ["showDashboard", "showDashboardBootstrapError", "showEditorAccessError"]) {
    assert.match(js, new RegExp(`function ${fn}\\([^)]*\\) \\{[\\s\\S]{0,200}revealDashboard\\(\\)`), fn);
  }
});
