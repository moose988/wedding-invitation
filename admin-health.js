// Shows a dismissible warning on admin pages when the server reports failed setup checks, or when the
// health check itself cannot run (which is exactly what a missing or misconfigured deploy looks like).
// It asks the server once per browser session and remembers the answer, so every page does not repeat it.
import { adminPost, esc, explainFailure, failedChecks } from "./admin-api.js";

const KEY = "qd:admin-health:v1", DISMISS = "qd:admin-health:dismissed";
const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; /* storage blocked: ask again */ } };
const write = value => { try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* storage blocked: the check simply runs again next page */ } };
const dismissed = () => { try { return sessionStorage.getItem(DISMISS) === "1"; } catch { return false; /* storage blocked: show it */ } };

export async function runAdminHealth(auth, fetchImpl = globalThis.fetch) {
  const cached = read(); if (cached) return cached;
  let result;
  try {
    let report;
    try { report = await adminPost(auth, "/api/admin-health", null, fetchImpl, { what: "The server health check", method: "GET" }); }
    catch (error) { if (error.status !== 405) throw error; report = await adminPost(auth, "/api/admin-health", {}, fetchImpl, { what: "The server health check" }); }
    result = { failures: failedChecks(report), runError: "" };
  } catch (error) {
    result = { failures: [], runError: error.message || explainFailure({ what: "The server health check" }) };
  }
  write(result);
  return result;
}

export function bannerHtml(result) {
  const items = result.failures.map(f => `<li><strong>${esc(f.name)}</strong>${f.message ? `: ${esc(f.message)}` : ""}</li>`).join("");
  return `<div class="admin-banner" role="alert"><div><strong>Server setup needs attention.</strong>${result.runError ? `<p>${esc(result.runError)}</p>` : ""}${items ? `<ul>${items}</ul>` : ""}<p>Some actions on this site may fail until an admin fixes this.</p></div><button class="secondary-button" type="button" data-banner-dismiss>Dismiss</button></div>`;
}

export async function mountAdminHealth(auth, { host = document.getElementById("workspace") } = {}) {
  if (!host || dismissed()) return;
  const result = await runAdminHealth(auth);
  if (!result.runError && !result.failures.length) return;
  if (dismissed() || host.querySelector(".admin-banner")) return;
  const nav = host.querySelector(".workspace-tabs");
  (nav || host.firstElementChild).insertAdjacentHTML("afterend", bannerHtml(result));
  host.querySelector("[data-banner-dismiss]").addEventListener("click", event => {
    try { sessionStorage.setItem(DISMISS, "1"); } catch { /* storage blocked: it returns on the next page */ }
    event.target.closest(".admin-banner").remove();
  });
}
