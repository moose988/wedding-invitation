const shell = document.getElementById("sideShell");
const params = new URLSearchParams(window.location.search);

const side = ["groom", "bride", "family"].includes(params.get("side")) ? params.get("side") : "groom";
const isDemo = params.get("demo") === "1" || params.get("wedding") === "luxury-wedding-demo";
const weddingId = params.get("wedding") || "";
let stopLiveStats = null;
let stopLiveTables = null;

const SIDE_META = {
  groom: { en: "Groom side", ar: "أهل العريس", accent: "#1f5a4d", accentSoft: "#dbe9e4" },
  bride: { en: "Bride side", ar: "أهل العروس", accent: "#b89156", accentSoft: "#efe3cf" },
  family: { en: "Family & shared", ar: "العائلة", accent: "#8b8678", accentSoft: "#eee9df" },
};

init();

async function init() {
  document.documentElement.style.setProperty("--side-accent", SIDE_META[side].accent);
  document.documentElement.style.setProperty("--side-accent-soft", SIDE_META[side].accentSoft);

  try {
    const data = isDemo ? loadDemoData() : await loadLiveData();
    if (!data) {
      renderEmpty(
        "Nothing to show yet",
        isDemo
          ? "Open the planner dashboard in preview mode first so this page has demo data to display."
          : "Ask your wedding planner to open the dashboard once — it publishes the latest numbers for this page."
      );
      return;
    }
    render(data);
    if (!isDemo) startLiveListeners();
  } catch (error) {
    console.error(error);
    renderEmpty("We could not load this page", "Please check your connection and try again, or ask your wedding planner for a fresh link.");
  }
}

function loadDemoData() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem("da3wa:demoDashboardState:v4"));
  } catch {
    saved = null;
  }
  if (!saved || !Array.isArray(saved.guests) || !Array.isArray(saved.tables)) {
    return null;
  }
  const guests = saved.guests.filter((guest) => sideViewMatches(guest, side));
  const seatsByGuest = collectSeatsByGuest(saved.tables);
  const confirmed = guests.filter((guest) => guest.rsvpStatus === "confirmed");
  return {
    coupleName: "Sara & Khalid",
    stats: {
      invited: guests.length,
      seats: guests.reduce((sum, guest) => sum + partySize(guest), 0),
      confirmed: confirmed.length,
      confirmedSeats: confirmed.reduce((sum, guest) => sum + partySize(guest), 0),
      pending: guests.filter((guest) => !["confirmed", "declined"].includes(guest.rsvpStatus)).length,
      declined: guests.filter((guest) => guest.rsvpStatus === "declined").length,
      invitesSent: guests.filter((guest) => guest.inviteSentAt || guest.reminderSentAt).length,
    },
    roster: guests.map((guest) => ({
      id: guest.id,
      n: guest.fullName || "",
      a: guest.fullNameAr || "",
      r: ["confirmed", "declined"].includes(guest.rsvpStatus) ? guest.rsvpStatus : "pending",
      p: partySize(guest),
      seats: (seatsByGuest.get(guest.id) || []).map((seat) => ({ t: seat.tableName, n: seat.seatNumber })),
    })),
    tables: saved.tables,
  };
}

async function loadLiveData() {
  if (!weddingId) {
    return null;
  }
  const { initFirebase, isFirebaseConfigured, doc, getDoc, getDocs, collection } = await import("./firebase-config.js");
  if (!isFirebaseConfigured()) {
    return null;
  }
  const db = initFirebase().db;
  const [weddingSnap, statsSnap, tablesSnap] = await Promise.all([
    getDoc(doc(db, "weddings", weddingId)),
    getDoc(doc(db, "weddings", weddingId, "publicStats", "summary")),
    getDocs(collection(db, "weddings", weddingId, "tables")),
  ]);
  if (!weddingSnap.exists() || !statsSnap.exists()) {
    return null;
  }
  const stats = statsSnap.data();
  return {
    coupleName: stats.coupleName || weddingSnap.data().coupleName || "The Wedding",
    stats: stats.sides?.[side] || null,
    roster: stats.roster?.[side] || [],
    // Keep this page on the same Firestore table identity as the dashboard.
    // Some older records contain an embedded legacy id that is not their
    // document ID; allowing it to win can make this page show a different
    // seating plan from the planner.
    tables: tablesSnap.docs.map((docSnapshot) => ({ ...docSnapshot.data(), id: docSnapshot.id })),
  };
}

async function startLiveListeners() {
  if (!weddingId) return;
  const { initFirebase, isFirebaseConfigured, doc, onSnapshot } = await import("./firebase-config.js");
  if (!isFirebaseConfigured()) return;
  const db = initFirebase().db;
  const redraw = async () => {
    try {
      const data = await loadLiveData();
      if (data) render(data);
    } catch (error) {
      console.error(error);
      renderEmpty("Live update unavailable", "Your saved seating plan is still available. Refresh to retry the connection.");
    }
  };
  stopLiveStats?.(); stopLiveTables?.();
  stopLiveStats = onSnapshot(doc(db, "weddings", weddingId, "publicStats", "summary"), redraw, () => renderEmpty("Live update unavailable", "Please refresh and try again."));
  stopLiveTables = onSnapshot(doc(db, "weddings", weddingId), () => redraw());
}

function sideViewMatches(guest, viewSide) {
  const guestSide = normalizeSide(guest.side);
  if (viewSide === "groom" || viewSide === "bride") {
    return guestSide === viewSide || guestSide === "both";
  }
  return guestSide === "family";
}

function normalizeSide(value) {
  const side = String(value || "").trim().toLowerCase().replace(/[ _-]+/g, " ");
  if (["bride", "bride side", "brides side"].includes(side)) return "bride";
  if (["groom", "groom side", "grooms side"].includes(side)) return "groom";
  if (["both", "both sides", "shared"].includes(side)) return "both";
  return "family";
}

function partySize(guest) {
  const extra = Number(guest.additionalGuests);
  return 1 + (Number.isFinite(extra) && extra > 0 ? Math.floor(extra) : 0);
}

function chairGuestId(table, chair) {
  return chair?.assignment?.guestId || chair?.guestId || "";
}

function collectSeatsByGuest(tables) {
  const map = new Map();
  tables.forEach((table) => {
    (table.chairs || []).forEach((chair) => {
      const guestId = chairGuestId(table, chair);
      if (!guestId) {
        return;
      }
      if (!map.has(guestId)) {
        map.set(guestId, []);
      }
      map.get(guestId).push({ tableName: table.name || "Table", seatNumber: Number(chair.seatNumber) || 0 });
    });
  });
  return map;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmpty(title, message) {
  shell.innerHTML = `
    <div class="side-empty">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function render(data) {
  if (!data.stats) {
    renderEmpty("Nothing to show yet", "No guests are assigned to this side yet.");
    return;
  }
  const meta = SIDE_META[side];
  const sideGuestIds = new Set(data.roster.map((entry) => entry.id));

  shell.innerHTML = `
    <header class="side-header">
      <p class="side-eyebrow">${escapeHtml(data.coupleName)} · Wedding status</p>
      <h1>${escapeHtml(meta.en)} <span class="side-ar" dir="rtl">${escapeHtml(meta.ar)}</span></h1>
      <p>A live overview of this side's guests — updated automatically as replies arrive.</p>
    </header>

    <section class="side-tiles" aria-label="Guest numbers">
      <article class="side-tile side-tile--coming">
        <strong>${data.stats.confirmed}</strong>
        <span>Coming · ${data.stats.confirmedSeats} seat${data.stats.confirmedSeats === 1 ? "" : "s"}</span>
      </article>
      <article class="side-tile">
        <strong>${data.stats.invitesSent}/${data.stats.invited}</strong>
        <span>Invitations sent</span>
      </article>
      <article class="side-tile">
        <strong>${data.stats.pending}</strong>
        <span>Awaiting reply</span>
      </article>
      <article class="side-tile side-tile--declined">
        <strong>${data.stats.declined}</strong>
        <span>Not coming</span>
      </article>
    </section>

    <section class="side-card">
      <h2>Seating plan</h2>
      <p>Highlighted chairs belong to this side's guests.</p>
      ${renderFloorMap(data.tables, sideGuestIds)}
      <div class="floor-legend">
        <span class="legend-side"><i></i>This side</span>
        <span class="legend-occupied"><i></i>Other guests</span>
        <span><i></i>Free chair</span>
      </div>
    </section>

    <section class="side-card">
      <h2>Who sits where</h2>
      <p>Seat assignments for this side's confirmed guests.</p>
      ${renderRoster(data.roster)}
    </section>

    <p class="side-footnote">Shared with love by the wedding planners.<br />Made with DA3WA Planner Suite.</p>
  `;
}

function renderFloorMap(tables, sideGuestIds) {
  if (!tables.length) {
    return '<p class="side-footnote">The seating layout has not been created yet.</p>';
  }
  // Table sizes are stored in planner pixels; shrink them so the whole floor
  // fits a phone-width map without tables overlapping or clipping.
  const scale = Math.min(0.62, Math.max(0.3, (window.innerWidth - 60) / 1600));
  const tableMarkup = tables
    .map((table) => {
      const width = Math.max(40, Number(table.width || 160) * scale);
      const height = Math.max(40, Number(table.height || 160) * scale);
      const chairs = (table.chairs || [])
        .map((chair) => {
          const guestId = chairGuestId(table, chair);
          const chairClass = guestId ? (sideGuestIds.has(guestId) ? "floor-chair--side" : "floor-chair--occupied") : "";
          return `<i class="floor-chair ${chairClass}" style="left:${Number(chair.x) || 50}%; top:${Number(chair.y) || 50}%;"></i>`;
        })
        .join("");
      const occupied = (table.chairs || []).filter((chair) => chairGuestId(table, chair)).length;
      return `
        <div
          class="floor-table ${table.shape === "round" ? "floor-table--round" : ""}"
          style="left:${Number(table.x) || 20}%; top:${Number(table.y) || 20}%; width:${width}px; height:${height}px;"
        >
          <span class="floor-table__name">${escapeHtml(table.name || "Table")}</span>
          <span class="floor-table__count">${occupied}/${Number(table.seatCount || table.capacity || 0)}</span>
          ${chairs}
        </div>
      `;
    })
    .join("");
  return `<div class="floor-map">${tableMarkup}</div>`;
}

function renderRoster(roster) {
  const seated = roster.filter((entry) => entry.seats.length);
  const unseatedComing = roster.filter((entry) => !entry.seats.length && entry.r === "confirmed");

  const byTable = new Map();
  seated.forEach((entry) => {
    const tableName = entry.seats[0].t || "Table";
    if (!byTable.has(tableName)) {
      byTable.set(tableName, []);
    }
    byTable.get(tableName).push(entry);
  });

  const groups = [...byTable.entries()]
    .map(
      ([tableName, entries]) => `
        <div class="roster-group">
          <h3>${escapeHtml(tableName)}</h3>
          ${entries.map((entry) => rosterRow(entry, entry.seats.map((seat) => seat.n).sort((a, b) => a - b).join(", "))).join("")}
        </div>
      `
    )
    .join("");

  const unseatedBlock = unseatedComing.length
    ? `
      <div class="roster-group">
        <h3>Coming — seat to be assigned</h3>
        ${unseatedComing.map((entry) => rosterRow(entry, "")).join("")}
      </div>
    `
    : "";

  if (!groups && !unseatedBlock) {
    return '<p class="side-footnote">No confirmed guests from this side have seats yet.</p>';
  }
  return groups + unseatedBlock;
}

function rosterRow(entry, seatLabel) {
  return `
    <div class="roster-row">
      <span class="roster-name">${escapeHtml(entry.n)}${entry.a ? `<small dir="rtl">${escapeHtml(entry.a)}</small>` : ""}</span>
      <span class="roster-meta">${entry.p > 1 ? `party of ${entry.p}` : ""}${entry.p > 1 && seatLabel ? " · " : ""}${seatLabel ? `seat${seatLabel.includes(",") ? "s" : ""} ${escapeHtml(seatLabel)}` : ""}</span>
    </div>
  `;
}
