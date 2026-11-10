// The "Usage and cost" section: a collapsible panel in the same design as the Access section,
// shown to administrators on the event dashboard's settings and on the photo bucket page.
// For an event it asks the admin API for record counts when it is first opened. For a photo
// bucket it uses the figures the page already has. Every number is labelled as an estimate.
import { adminPost, esc } from "./admin-api.js";
import { ensureSectionStyles } from "./access-section.js";
import { FREE_DAILY, bucketEstimate, eventEstimate, money, shareOf, sizeText } from "./event-usage.js";

const row = (label, value, note = "") => `<div class="ux-row"><dt>${esc(label)}</dt><dd>${esc(value)}${note ? `<small>${esc(note)}</small>` : ""}</dd></div>`;
// "about $0.28", but never "about under $0.01".
const about = (amount) => { const text = money(amount); return text.startsWith("under") || text === "$0.00" ? text : `about ${text}`; };
const count = (value) => Number(value || 0).toLocaleString("en-US");

function eventHtml(data) {
  const e = eventEstimate(data);
  const shared = data.eventCategory === "gender_reveal";
  return `<p class="ax-note">Firebase is on the free plan, so this event costs nothing there. What it uses is a share of the free daily allowance (${count(FREE_DAILY.reads)} reads and ${count(FREE_DAILY.writes)} writes a day, shared by all events).</p>
    <dl class="ux-list">${row("Stored records", count(e.records), shared ? `${count(e.people)} responses` : `${count(e.people)} guests`)}
    ${row("Opening the dashboard once", `about ${count(e.dashboardOpen)} reads`, `${shareOf(e.dashboardOpen, FREE_DAILY.reads)} of a day's reads`)}
    ${row(shared ? "One guest opening the shared page" : "One guest opening their invitation", `about ${count(e.invitationOpen)} reads`)}
    ${row(shared ? "Every response so far, opened once" : "Every guest opening it once", `about ${count(e.everyoneOpensOnce)} reads`, `${shareOf(e.everyoneOpensOnce, FREE_DAILY.reads)} of a day's reads`)}
    ${row(shared ? "Each new response" : "Every guest replying once", shared ? `${e.replyWrites} writes` : `about ${count(e.everyoneReplies)} writes`, shared ? "" : `${shareOf(e.everyoneReplies, FREE_DAILY.writes)} of a day's writes`)}
    ${row("Downloading a backup", `about ${count(e.backupDownload)} reads`, `${shareOf(e.backupDownload, FREE_DAILY.reads)} of a day's reads`)}</dl>
    ${data.customSong ? `<p class="ax-note">This event has its own song, stored on AWS. One song costs well under $0.01 a month.</p>` : ""}
    <p class="ax-note">These are estimates worked out from the event's size. Firebase does not report usage per event.</p>`;
}

function bucketHtml(bucket) {
  const cost = bucketEstimate(bucket);
  return `<dl class="ux-list">${row("Photos", count(bucket.photoCount))}
    ${row("Storage used", `${sizeText(bucket.usedBytes)} of ${bucket.limitGb ?? "?"} GB`, `${about(cost.storage)} a month`)}
    ${row("Backup copies", sizeText(bucket.backupBytes), `${about(cost.backup)} a month`)}
    ${row("Cost now", `${about(cost.total)} a month`)}
    ${row("If the bucket fills up", `${about(cost.whenFull)} a month`)}</dl>
    <p class="ax-note">Approximate AWS storage prices in US dollars, charged for as long as the bucket exists. Uploads and downloads add a little on top and are not included.</p>`;
}

// target is { kind: "event", id } or { kind: "bucket" } with getBucket() returning the bucket's current figures.
export function mountUsageSection(host, { auth, target, getBucket = null }) {
  ensureSectionStyles();
  host.innerHTML = `<details class="access-section usage-section"><summary>Usage and cost</summary><div class="access-section__body" data-body><p class="ax-note">Open to load…</p></div></details>`;
  const details = host.querySelector("details"), body = host.querySelector("[data-body]");
  async function load() {
    body.innerHTML = `<p class="ax-note">Working it out…</p>`;
    try {
      const html = target.kind === "bucket" ? bucketHtml(await getBucket()) : eventHtml(await adminPost(auth, "/api/admin-event-backup", { action: "usage", eventId: target.id }, undefined, { what: "Loading the usage figures" }));
      if (host.isConnected) body.innerHTML = `${html}<button class="ax-link" type="button" data-refresh>Refresh</button>`;
    } catch (failure) {
      body.innerHTML = `<p class="ax-error" role="alert">${esc(failure?.message || "The figures could not load.")}</p><button class="ax-link" type="button" data-refresh>Try again</button>`;
    }
  }
  let loaded = false;
  details.addEventListener("toggle", () => { if (details.open && !loaded) { loaded = true; void load(); } });
  body.addEventListener("click", (event) => { if (event.target.closest("[data-refresh]")) void load(); });
  return details;
}
