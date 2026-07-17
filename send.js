const shell = document.getElementById("senderShell");

const payload = decodePayload();
const sentStorageKey = payload ? `da3wa:senderSent:${payload.w || "wedding"}` : "";
let sentMap = readSentMap();

render();

function decodePayload() {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const data = hash.get("data");
  if (!data) {
    return null;
  }
  try {
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || !Array.isArray(parsed.g)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("Could not read the sender payload.", error);
    return null;
  }
}

function readSentMap() {
  if (!sentStorageKey) {
    return {};
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(sentStorageKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistSentMap() {
  if (sentStorageKey) {
    localStorage.setItem(sentStorageKey, JSON.stringify(sentMap));
  }
}

function guestKey(guest) {
  return guest.t || guest.p;
}

function buildInviteLink(guest) {
  const url = new URL("index.html", window.location.href);
  if (payload.w) {
    url.searchParams.set("wedding", payload.w);
  }
  if (guest.t) {
    url.searchParams.set("guest", guest.t);
  }
  return url.toString();
}

function buildWhatsAppLink(guest) {
  const couple = payload.c || "our wedding";
  const arabicName = guest.a || guest.n;
  const inviteLink = buildInviteLink(guest);
  const message = [
    `دعوة زفاف ${couple} 💍`,
    `مرحباً ${arabicName}! يسعدنا ويشرفنا دعوتكم لحضور حفل زفافنا. كل التفاصيل وتأكيد الحضور في الرابط:`,
    `Hello ${guest.n}! We would be honored to have you at our wedding. All the details and RSVP are here:`,
    inviteLink,
  ].join("\n\n");
  return `https://wa.me/${guest.p}?text=${encodeURIComponent(message)}`;
}

function sideLabel(side) {
  if (side === "groom") return "Groom";
  if (side === "bride") return "Bride";
  if (side === "family") return "Family";
  if (side === "both") return "Both";
  return "Guest";
}

function sideChipClass(side) {
  if (side === "groom") return "sender-chip--groom";
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
        <h1>This sender link is empty or invalid</h1>
        <p>Ask your wedding planner to generate a fresh WhatsApp sender link from the dashboard's Invitations page and send it to you again.</p>
      </div>
    `;
    return;
  }

  const guests = payload.g;
  const sentCount = guests.filter((guest) => sentMap[guestKey(guest)]).length;
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
      <h1>${escapeHtml(payload.c || "Wedding")} — invitations</h1>
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
          const isSent = Boolean(sentMap[guestKey(guest)]);
          return `
            <article class="sender-row ${isSent ? "is-sent" : ""}">
              <div class="sender-row__info">
                <span class="sender-row__name">${escapeHtml(guest.n)}</span>
                ${guest.a ? `<span class="sender-row__name-ar" dir="rtl">${escapeHtml(guest.a)}</span>` : ""}
                <span class="sender-row__meta">
                  <span class="sender-chip ${sideChipClass(guest.s)}">${escapeHtml(sideLabel(guest.s))}</span>
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

    <p class="sender-footnote">Sent progress is saved on this phone only.<br />Made with DA3WA Planner Suite.</p>
  `;
}

shell.addEventListener("click", (event) => {
  const sendLink = event.target.closest("[data-send-index]");
  if (sendLink) {
    const guest = payload.g[Number(sendLink.dataset.sendIndex)];
    if (guest) {
      sentMap[guestKey(guest)] = Date.now();
      persistSentMap();
      // Re-render after the browser has followed the link to WhatsApp.
      setTimeout(render, 300);
    }
    return;
  }

  const undoButton = event.target.closest("[data-undo-index]");
  if (undoButton) {
    const guest = payload.g[Number(undoButton.dataset.undoIndex)];
    if (guest) {
      delete sentMap[guestKey(guest)];
      persistSentMap();
      render();
    }
  }
});
