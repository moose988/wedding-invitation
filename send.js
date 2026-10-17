import {
  buildSenderWhatsAppMessage,
  decodeSenderPayload,
  senderGuestPresentation,
} from "./sender-codec.js";
import { httpsCallable, initPublicFirebase, isFirebaseConfigured } from "./firebase-config.js?v=20261016-tab-session-isolation-1";
import { createShareUrl } from "./share-link.js";

const shell = document.getElementById("senderShell");
const params = new URLSearchParams(window.location.search);
const demoMode = params.get("demo") === "1";
const sessionToken = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("session") || "";
let payload = null;
let sentStorageKey = "";
let sentMap = {};
let senderRefreshTimer = null;
let senderRequestVersion = 0;

initializeSender();

async function initializeSender() {
  const version = ++senderRequestVersion;
  if (demoMode) {
    payload = decodeDemoPayload();
  } else if (isFirebaseConfigured() && /^[A-Za-z0-9_-]{43}$/.test(sessionToken)) {
    try {
      const { functions } = initPublicFirebase();
      const result = await httpsCallable(functions, "getSenderSession")({ token: sessionToken });
      if (version !== senderRequestVersion) return;
      payload = result.data;
    } catch {
      if (version !== senderRequestVersion) return;
      payload = null;
    }
  }
  if (payload?.sid) sentStorageKey = `da3wa:senderSent:${payload.sid}`;
  sentMap = readSentMap();
  if (payload?.w) {
  // Older sender pages persisted bearer tokens as localStorage keys. Remove
    // only this event's legacy progress record when it is next opened.
    try {
      localStorage.removeItem(`da3wa:senderSent:${payload.w}`);
    } catch {}
  }
  render();
  if (!demoMode && payload && !senderRefreshTimer) {
    senderRefreshTimer = window.setInterval(refreshSenderSession, 30_000);
  }
}

async function refreshSenderSession() {
  const version = ++senderRequestVersion;
  try {
    const { functions } = initPublicFirebase();
    const result = await httpsCallable(functions, "getSenderSession")({ token: sessionToken });
    if (version !== senderRequestVersion) return;
    payload = result.data;
    render();
  } catch {
    if (version !== senderRequestVersion) return;
    payload = null;
    sentMap = {};
    window.clearInterval(senderRefreshTimer);
    senderRefreshTimer = null;
    render();
  }
}

window.addEventListener("pagehide", () => {
  senderRequestVersion += 1;
  if (senderRefreshTimer) window.clearInterval(senderRefreshTimer);
  senderRefreshTimer = null;
}, { once: true });

function decodeDemoPayload() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const data = hash.get("data");
  if (!data) {
    return null;
  }
  try {
    return decodeSenderPayload(data);
  } catch {
    return null;
  }
}

function readSentMap() {
  if (!sentStorageKey) {
    return {};
  }
  try {
    const parsed = JSON.parse(sessionStorage.getItem(sentStorageKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistSentMap() {
  if (sentStorageKey) {
    sessionStorage.setItem(sentStorageKey, JSON.stringify(sentMap));
  }
}

function guestKey(_guest, index) {
  return `guest-${index}`;
}

function buildInviteLink(guest) {
  const url = createShareUrl("index.html", window.location.href);
  if (payload.w) {
    url.searchParams.set("wedding", payload.w);
  }
  if (guest.t) {
    url.hash = new URLSearchParams({ guest: guest.t }).toString();
  }
  return url.toString();
}

function buildWhatsAppLink(guest) {
  const inviteLink = buildInviteLink(guest);
  const message = buildSenderWhatsAppMessage(payload, guest, inviteLink);
  return `https://wa.me/${guest.p}?text=${encodeURIComponent(message)}`;
}

function sideLabel(side) {
  if (side === "groom") return "Groom";
  if (side === "bride") return "Bride";
  if (side === "family") return "Family";
  if (side === "both") return "Groom";
  return "Guest";
}

function sideChipClass(side) {
  if (side === "groom" || side === "both") return "sender-chip--groom";
  if (side === "bride") return "sender-chip--bride";
  return "sender-chip--other";
}

function formatPhone(phone) {
  return `+${phone}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function render() {
  if (!payload || !payload.g.length) {
    shell.innerHTML = `
      <div class="sender-empty">
        <h1>This sender link is unavailable</h1>
        <p>This link may have expired or been revoked. Ask your event planner to create a new WhatsApp sender link.</p>
      </div>
    `;
    return;
  }

  const guests = payload.g;
  const sentCount = guests.filter((guest, index) => sentMap[guestKey(guest, index)]).length;
  const sideTitle =
    payload.side === "groom"
      ? "Groom side"
      : payload.side === "bride"
        ? "Bride side"
        : payload.side === "family"
          ? "Family"
          : "All guests";

  shell.innerHTML = `
    <header class="sender-header">
      <p class="sender-eyebrow">${escapeHtml(sideTitle)} · WhatsApp sender</p>
      <h1>${escapeHtml(payload.c || "Event")} — invitations</h1>
      <p>Tap <strong>Send</strong> on each guest. WhatsApp opens with the invitation ready — just press the send arrow. Every message goes out from your own number.</p>
      <div class="sender-progress">
        <div class="sender-progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="${guests.length}" aria-valuenow="${sentCount}">
          <div class="sender-progress__bar" style="width:${guests.length ? Math.round((sentCount / guests.length) * 100) : 0}%"></div>
        </div>
        <span class="sender-progress__label" role="status">${sentCount} of ${guests.length} sent</span>
      </div>
    </header>

    <section class="sender-list">
      ${guests
        .map((guest, index) => {
          const isSent = Boolean(sentMap[guestKey(guest, index)]);
          const names = senderGuestPresentation(guest);
          return `
            <article class="sender-row ${isSent ? "is-sent" : ""}">
              <div class="sender-row__info">
                <span class="sender-row__name">${escapeHtml(names.displayName)}</span>
                <span class="sender-row__meta">
                  ${payload.cat === "celebration" ? "" : `<span class="sender-chip ${sideChipClass(guest.s)}">${escapeHtml(sideLabel(guest.s))}</span>`}
                  <span dir="ltr">${escapeHtml(formatPhone(guest.p))}</span>
                </span>
              </div>
              <div class="sender-row__actions">
                ${
                  guest.t
                    ? `<a class="sender-send" href="${escapeHtml(buildWhatsAppLink(guest))}" target="_blank" rel="noopener noreferrer" data-send-index="${index}">
                        ${isSent ? "Sent ✓ · Resend" : "Send"}
                      </a>`
                    : `<span class="sender-send is-disabled" aria-disabled="true">No invite link</span>`
                }
                ${isSent ? `<button class="sender-undo" type="button" data-undo-index="${index}">Mark as not sent</button>` : ""}
              </div>
            </article>
          `;
        })
        .join("")}
    </section>

    <p class="sender-footnote">Sent progress is saved in this browser tab only.<br />Made with qdsystems Planner Suite.</p>
  `;
}

function updateProgress() {
  if (!payload?.g?.length) return;
  const sentCount = payload.g.filter((guest, index) => sentMap[guestKey(guest, index)]).length;
  const progress = shell.querySelector(".sender-progress__track");
  const label = shell.querySelector(".sender-progress__label");
  const bar = shell.querySelector(".sender-progress__bar");
  if (progress) progress.setAttribute("aria-valuenow", String(sentCount));
  if (label) label.textContent = `${sentCount} of ${payload.g.length} sent`;
  if (bar) bar.style.width = `${Math.round((sentCount / payload.g.length) * 100)}%`;
}

shell.addEventListener("click", (event) => {
  const sendLink = event.target.closest("[data-send-index]");
  if (sendLink) {
    const guest = payload.g[Number(sendLink.dataset.sendIndex)];
    if (guest) {
      sentMap[guestKey(guest, Number(sendLink.dataset.sendIndex))] = Date.now();
      persistSentMap();
      const row = sendLink.closest(".sender-row");
      row?.classList.add("is-sent");
      sendLink.textContent = "Sent ✓ · Resend";
      if (row && !row.querySelector("[data-undo-index]")) {
        const undo = document.createElement("button");
        undo.className = "sender-undo";
        undo.type = "button";
        undo.dataset.undoIndex = sendLink.dataset.sendIndex;
        undo.textContent = "Mark as not sent";
        sendLink.parentElement?.append(undo);
      }
      updateProgress();
    }
    return;
  }

  const undoButton = event.target.closest("[data-undo-index]");
  if (undoButton) {
    const guest = payload.g[Number(undoButton.dataset.undoIndex)];
    if (guest) {
      delete sentMap[guestKey(guest, Number(undoButton.dataset.undoIndex))];
      persistSentMap();
      const row = undoButton.closest(".sender-row");
      row?.classList.remove("is-sent");
      const sendAction = row?.querySelector("[data-send-index]");
      if (sendAction) sendAction.textContent = "Send";
      undoButton.remove();
      updateProgress();
    }
  }
});
