// The panel that opens under an event card's Access button on the All Events page. Loaded on
// first use. It holds the same Access section used on every other page (access-section.js).
import { esc } from "./admin-api.js";
import { getEventDisplayTitle } from "./event-utils.js";
import { mountAccessSection } from "./access-section.js";

let open = null; // { panel, eventId, close }

export function closeEventAccess() { open?.close(); }

// Opens the panel under `anchor`, or closes it when it is already open for this event.
export function toggleEventAccess({ anchor, wedding, services, flash = () => {} }) {
  if (open) { const same = open.eventId === wedding.id; open.close(); if (same) return null; }
  const title = getEventDisplayTitle(wedding);
  const panel = document.createElement("section");
  panel.className = "access-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `Access to ${title}`);
  panel.innerHTML = `<header><h3>Access</h3><button class="icon-close" type="button" data-access-close aria-label="Close">×</button></header><p class="access-panel__event"><bdi>${esc(title)}</bdi></p><div data-access-host></div>`;
  document.body.append(panel);
  // The card is redrawn when the list refreshes, so the button is looked up again each time.
  const button = () => document.querySelector(`[data-action="access"][data-id="${CSS.escape(wedding.id)}"]`) || anchor;
  function place() {
    const box = button().getBoundingClientRect();
    const width = Math.min(400, window.innerWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(12, Math.min(box.left + window.scrollX, window.scrollX + window.innerWidth - width - 12))}px`;
    panel.style.top = `${box.bottom + window.scrollY + 8}px`;
  }
  const onOutside = (event) => { if (!panel.contains(event.target) && !event.target.closest?.('[data-action="access"]') && !event.target.closest?.("dialog")) close(); };
  const onKey = (event) => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) { close(); button().focus?.(); } };
  function close() {
    if (open?.panel !== panel) return;
    open = null; panel.remove();
    document.removeEventListener("pointerdown", onOutside, true); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", place);
    document.querySelectorAll('[data-action="access"][aria-expanded="true"]').forEach((item) => item.setAttribute("aria-expanded", "false"));
  }
  open = { panel, eventId: wedding.id, close };
  document.addEventListener("pointerdown", onOutside, true); document.addEventListener("keydown", onKey); window.addEventListener("resize", place);
  panel.querySelector("[data-access-close]").addEventListener("click", close);
  anchor.setAttribute("aria-expanded", "true");
  place();
  mountAccessSection(panel.querySelector("[data-access-host]"), { auth: services.auth, target: { kind: "event", id: wedding.id }, title, bare: true, flash });
  return panel;
}
