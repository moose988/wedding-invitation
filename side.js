import {
  initFirebase,
  initSeatingEditorFirebase,
  isFirebaseConfigured,
  doc,
  getDoc,
  httpsCallable,
  onSnapshot,
  signInWithCustomToken,
} from "./firebase-config.js?v=20261016-tab-session-isolation-1";
import { resolveTableName } from "./seating-utils.js";
import { getEventDisplayTitle, isCelebrationEvent } from "./event-utils.js";
import {
  initializeFirebaseServicesForRoute,
  waitForFirebaseSessionPersistence,
} from "./firebase-service-scopes.js";

const shell = document.querySelector("#sideShell");
const modalRoot = document.querySelector("#modalRoot");
const params = new URLSearchParams(location.search);
const roleHint = ["bride", "groom", "family"].includes(params.get("side"))
  ? params.get("side")
  : "family";
const editorToken = params.get("token") || "";
const demo = params.get("demo") === "1";
let state = {
  role: roleHint,
  editable: false,
  weddingId: params.get("wedding") || "",
  guests: [],
  tables: [],
  wedding: null,
  pending: false,
  transform: { x: 0, y: 0, scale: 0.42 },
  mapInitialized: false,
  action: null,
  unsubs: [],
  initialized: false,
};

init();

async function init() {
  if (state.initialized) return;
  state.initialized = true;
  window.addEventListener("pagehide", disposeListeners, { once: true });
  try {
    if (demo) {
      loadDemo();
      render();
      return;
    }
    if (!isFirebaseConfigured())
      throw new Error("Firebase has not been configured.");
    const services = initializeFirebaseServicesForRoute(
      { seatingEditor: Boolean(editorToken) },
      { dashboard: initFirebase, seating: initSeatingEditorFirebase },
    );
    state.services = services;
    if (editorToken) await waitForFirebaseSessionPersistence(services);
    await services.persistenceReady;
    if (editorToken) {
      const exchange = httpsCallable(
        services.functions,
        "exchangeSeatingEditorLink",
      );
      const result = await exchange({ token: editorToken });
      await signInWithCustomToken(services.auth, result.data.customToken);
      history.replaceState(null, "", `side.html?side=${roleHint}`);
    }
    const user = services.auth.currentUser;
    if (user) {
      const claims = (await user.getIdTokenResult(true)).claims;
      if (
        claims.seatingEditor &&
        claims.seatingWeddingId &&
        ["bride", "groom", "family"].includes(claims.seatingRole)
      ) {
        state.role = claims.seatingRole;
        state.editable = ["bride", "groom"].includes(state.role);
        state.weddingId = claims.seatingWeddingId;
      } else if (state.weddingId) {
        const account = await getDoc(doc(services.db, "weddings", state.weddingId, "dashboardUsers", user.uid));
        const permission = account.exists() ? account.data() : {};
        if (permission.seatingOnly === true && permission.canEditSeating === true && ["bride", "groom", "all"].includes(permission.allowedSide)) {
          state.role = permission.allowedSide;
          state.editable = true;
        }
      }
    }
    if (!state.weddingId)
      throw new Error("This link is incomplete or has expired.");
    subscribe();
  } catch (error) {
    console.error(error);
    renderError(error.message || "Unable to open this seating page.");
  }
}

function subscribe() {
  const { db } = state.services;
  const root = `weddings/${state.weddingId}`;
  state.unsubs.forEach((stop) => stop());
  state.unsubs = [];
  if (state.editable) {
    void refreshSideSeatingData();
    const timer = setInterval(() => void refreshSideSeatingData(), 10000);
    state.unsubs.push(() => clearInterval(timer));
    return;
  }
  if (!state.editable) {
    state.unsubs.push(onSnapshot(
      doc(db, root, "publicSummary", "summary"),
      (snap) => {
        state.publicStats = snap.exists() ? snap.data() : null;
        state.wedding = snap.exists() ? {
          id: state.weddingId,
          eventTitle: snap.data().eventTitle || "",
          coupleName: snap.data().coupleName || "",
          eventCategory: snap.data().eventCategory || "wedding_engagement",
          seatingEnabled: snap.data().seatingEnabled !== false,
        } : null;
        state.tables = [];
        state.guests = [];
        render();
      },
      fail,
    ));
    return;
  }
  state.unsubs = [];
}
let seatingRefreshPending = false;
async function refreshSideSeatingData() {
  if (seatingRefreshPending || !state.editable) return;
  seatingRefreshPending = true;
  try {
    const load = httpsCallable(state.services.functions, "getSideSeatingState");
    const result = await load({ weddingId: state.weddingId });
    state.role = result.data.role;
    state.wedding = result.data.wedding;
    state.tables = (result.data.tables || []).map(normalizeTable);
    state.guests = result.data.guests || [];
    render();
  } catch {
    state.wedding = null;
    state.tables = [];
    state.guests = [];
    renderError("This seating access is unavailable. Refresh or contact the event owner.");
  } finally {
    seatingRefreshPending = false;
  }
}
function disposeListeners() {
  state.unsubs.forEach((stop) => stop());
  state.unsubs = [];
}
function fail(error) {
  console.error(error);
  state.publicStats = null;
  state.wedding = null;
  state.tables = [];
  state.guests = [];
  renderError("This event's public seating summary is unavailable.");
}

function loadDemo() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("da3wa:demoDashboardState:v4"),
    );
    if (!saved) throw Error();
    state.wedding = { coupleName: "Sara & Khalid" };
    state.guests = saved.guests || [];
    state.tables = (saved.tables || []).map(normalizeTable);
    state.editable = true;
    state.role = "bride";
  } catch {
    renderError(
      "Open the dashboard preview first so its demo seating plan is available.",
    );
  }
}

function normalizeTable(table) {
  return {
    ...table,
    name: resolveTableName(table),
    x: Number(table.x ?? 20),
    y: Number(table.y ?? 20),
    width: Number(table.width || 160),
    height: Number(table.height || 160),
    chairs: (table.chairs || []).map((chair, i) => ({
      ...chair,
      id: chair.id || `${table.id}-chair-${i + 1}`,
      seatNumber: Number(chair.seatNumber || i + 1),
    })),
  };
}
function assignment(table, chair) {
  const value =
    chair.assignment || (chair.guestId ? { guestId: chair.guestId } : null);
  if (!value?.guestId) return null;
  const index = Number.isInteger(Number(value.partyMemberIndex))
    ? Number(value.partyMemberIndex)
    : value.personKey === "main"
      ? 0
      : Number(String(value.personKey || "").replace("guest-", "")) || 0;
  return {
    ...value,
    guestId: value.guestId,
    tableId: table.id,
    tableName: resolveTableName(table),
    chairId: chair.id,
    seatNumber: Number(value.seatNumber || chair.seatNumber),
    partyMemberIndex: index,
    personKey: value.personKey || personKey(index),
    label: value.label || personLabel(index),
  };
}
const personKey = (i) => (Number(i) === 0 ? "main" : `guest-${Number(i)}`);
const personLabel = (i) =>
  Number(i) === 0 ? "Main guest" : `Additional guest ${Number(i)}`;
const partySize = (guest) =>
  1 +
  Math.max(
    0,
    Number.isInteger(Number(guest?.additionalGuests))
      ? Number(guest.additionalGuests)
      : 0,
  );
const assignments = (tables = state.tables) =>
  tables.flatMap((table) =>
    table.chairs
      .map((chair) => {
        const a = assignment(table, chair);
        return a && { ...a, table, chair };
      })
      .filter(Boolean),
  );
const occupiedBy = (table, chair) => assignment(table, chair);
const findGuest = (id) => state.guests.find((g) => g.id === id);
const personName = (a) =>
  `${findGuest(a.guestId)?.fullName || "Guest"} · ${a.label}`;

function buildStats() {
  const guests = state.guests;
  const seated = new Set(
    assignments().map((a) => `${a.guestId}:${a.personKey}`),
  );
  const confirmed = guests.filter((g) => g.rsvpStatus === "confirmed");
  return {
    total: guests.length,
    invited: guests.reduce((n, g) => n + partySize(g), 0),
    sent: guests.filter((g) => g.inviteSentAt || g.reminderSentAt).length,
    confirmed: confirmed.length,
    declined: guests.filter((g) => g.rsvpStatus === "declined").length,
    pending: guests.filter(
      (g) => !["confirmed", "declined"].includes(g.rsvpStatus),
    ).length,
    seated: seated.size,
    unseated: guests.reduce((n, g) => n + partySize(g), 0) - seated.size,
  };
}
function render() {
  if (!state.wedding) return;
  if (state.wedding.seatingEnabled === false) {
    shell.innerHTML = `<section class="card head"><div><p class="eyebrow">Seating unavailable</p><h1>Seating is disabled</h1><p class="muted">The event owner has disabled seating for this event.</p></div></section>`;
    return;
  }
  const s = state.editable ? buildStats() : publicViewStats();
  const title = getEventDisplayTitle(state.wedding);
  const accessLabel = isCelebrationEvent(state.wedding)
    ? "All guest status"
    : state.editable
    ? `${cap(state.role)} manager`
    : `Read-only ${cap(state.role)} status`;
  const publicSummary = !state.editable;
  shell.innerHTML = `<section class="card head"><div><p class="eyebrow">Live event seating</p><h1>${esc(title)}</h1><p class="muted">${publicSummary ? "Guest status totals for this event." : "Manage your permitted guest side. Changes sync instantly."}</p></div><span class="badge ${state.editable ? "" : "readonly"}">${accessLabel}</span></section>
  <section class="stats" aria-label="Guest statistics">${stat(s.total, "Guest invitations")}${stat(s.invited, "People invited")}${stat(s.confirmed, "Coming")}${stat(s.declined, "Declined")}${stat(s.pending, "Pending")}${stat(s.sent, "Invitations sent")}${stat(s.seated, "People seated")}${stat(s.unseated, "Unseated people")}</section>
  ${publicSummary ? `<section class="card guest-card"><h2>Guest status</h2><p class="muted">Names, contact details, and individual seat assignments are available only to authorized event staff.</p></section>` : `<section class="card workspace-card"><h2>Seating layout</h2><p class="muted">Tap a chair to assign, move, swap, or unassign its occupant.</p><div class="toolbar"><button class="btn" data-zoom="in" aria-label="Zoom in">Zoom in</button><button class="btn" data-zoom="out" aria-label="Zoom out">Zoom out</button><button class="btn" data-zoom="fit">Fit layout</button><button class="btn" data-zoom="reset">Reset</button></div><div class="map-viewport" id="mapViewport"><div class="map-world" id="mapWorld">${renderTables()}</div></div></section>
  <section class="card guest-card"><h2>Guest list</h2><p class="muted">Your permitted guest side, including additional guests.</p><div class="roster">${renderRoster()}</div></section>`}`;
  bindMap();
}
function stat(value, label) {
  return `<div class="stat"><strong>${Number(value) || 0}</strong><span>${esc(label)}</span></div>`;
}
function publicViewStats() {
  const side = isCelebrationEvent(state.wedding)
    ? state.publicStats?.all || state.publicStats?.sides?.general || {}
    : state.publicStats?.sides?.[state.role] || {};
  return {
    total: side.invited || 0,
    invited: side.seats || 0,
    sent: side.invitesSent || 0,
    confirmed: side.confirmed || 0,
    declined: side.declined || 0,
    pending: side.pending || 0,
    seated: side.seated || 0,
    unseated: Math.max(0, (side.seats || 0) - (side.seated || 0)),
  };
}
function renderTables() {
  return state.tables
    .map((t) => {
      const occupied = t.chairs.filter((c) => occupiedBy(t, c)).length;
      return `<div class="table ${t.shape === "round" ? "round" : ""}" style="left:${t.x}%;top:${t.y}%;width:${t.width}px;height:${t.height}px;--fill:${esc(t.tableColor || "#f3ebdc")};--border:${esc(t.borderColor || "#bc9b61")}"><span class="table-label">${esc(t.name)}<small>${occupied}/${t.chairs.length}</small></span>${t.chairs
        .map((c) => {
          const a = occupiedBy(t, c);
          const occupant = a?.restricted ? "Occupied by another side" : a ? personName(a) : "Empty";
          const label = a?.restricted ? "•" : a ? (a.partyMemberIndex === 0 ? initials(findGuest(a.guestId)?.fullName) : `+${a.partyMemberIndex}`) : c.seatNumber;
          return `<button class="chair ${a ? "occupied" : ""}" style="left:${Number(c.x) || 50}%;top:${Number(c.y) || 50}%" data-chair="1" data-table-id="${esc(t.id)}" data-chair-id="${esc(c.id)}" aria-label="${esc(`${occupant}, ${t.name} chair ${c.seatNumber}`)}">${esc(String(label))}</button>`;
        })
        .join("")}</div>`;
    })
    .join("");
}
function renderRoster() {
  if (state.editable) {
    return (
      state.guests
        .slice()
        .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName)))
        .map((g) => {
          const as = assignments().filter((a) => a.guestId === g.id);
          return `<div class="row"><b>${esc(g.fullName || "Guest")} <small>(${esc(g.side || "family")})</small></b><small>${esc(g.rsvpStatus || "pending")} · ${as.length}/${partySize(g)} seated</small></div>`;
        })
        .join("") || "<div class=empty>No guests yet.</div>"
    );
  }
  return "<div class=empty>Individual guest records are private in this public view.</div>";
}

function bindMap() {
  const v = document.querySelector("#mapViewport"),
    w = document.querySelector("#mapWorld");
  if (!v || !w) return;
  if (!state.mapInitialized) {
    fitLayout();
    state.mapInitialized = true;
  }
  applyTransform();
  let start = null,
    moved = false;
  v.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-chair]")) return;
    start = {
      x: e.clientX,
      y: e.clientY,
      ox: state.transform.x,
      oy: state.transform.y,
    };
    moved = false;
    v.setPointerCapture(e.pointerId);
  });
  v.addEventListener("pointermove", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x,
      dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 5) moved = true;
    state.transform.x = start.ox + dx;
    state.transform.y = start.oy + dy;
    applyTransform();
  });
  v.addEventListener("pointerup", () => {
    start = null;
  });
  v.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      state.transform.scale = Math.max(
        0.2,
        Math.min(1.5, state.transform.scale * (e.deltaY > 0 ? 0.9 : 1.1)),
      );
      applyTransform();
    },
    { passive: false },
  );
  v.querySelectorAll("[data-chair]").forEach((b) =>
    b.addEventListener("click", () =>
      openChair(b.dataset.tableId, b.dataset.chairId),
    ),
  );
  document.querySelectorAll("[data-zoom]").forEach((b) =>
    b.addEventListener("click", () => {
      const z = b.dataset.zoom;
      if (z === "fit") fitLayout();
      else if (z === "reset") {
        state.transform = {
          x: Math.max(24, (v.clientWidth - 1600) / 2),
          y: Math.max(24, (v.clientHeight - 1000) / 2),
          scale: 1,
        };
      }
      else
        state.transform.scale = Math.max(
          0.2,
          Math.min(1.5, state.transform.scale * (z === "in" ? 1.2 : 0.8)),
        );
      applyTransform();
    }),
  );
  function applyTransform() {
    w.style.transform = `translate(${state.transform.x}px,${state.transform.y}px) scale(${state.transform.scale})`;
  }
  function fitLayout() {
    const padding = 48;
    const scale = Math.min(
      1,
      Math.max(
        0.2,
        Math.min(
          (v.clientWidth - padding) / 1600,
          (v.clientHeight - padding) / 1000,
        ),
      ),
    );
    state.transform = {
      x: Math.max(24, (v.clientWidth - 1600 * scale) / 2),
      y: Math.max(24, (v.clientHeight - 1000 * scale) / 2),
      scale,
    };
  }
}

function openChair(tableId, chairId) {
  const table = state.tables.find((t) => t.id === tableId),
    chair = table?.chairs.find((c) => c.id === chairId);
  if (!table || !chair) return;
  const a = occupiedBy(table, chair);
  if (a?.restricted) {
    openSheet(`<h2>${esc(table.name)} · chair ${chair.seatNumber}</h2><p class=muted>This chair is assigned within another guest side.</p><button class=btn data-close>Close</button>`);
    return;
  }
  if (!state.editable) {
    openSheet(
      `<h2>${esc(table.name)} · chair ${chair.seatNumber}</h2><p class=muted>${a ? esc(personName(a)) : "This chair is empty."}</p><button class=btn data-close>Close</button>`,
    );
    return;
  }
  if (state.action?.type === "move" && !a) {
    mutate("move", state.action.assignment, { tableId, chairId });
    return;
  }
  if (state.action?.type === "swap" && a) {
    mutate("swap", state.action.assignment, { tableId, chairId });
    return;
  }
  if (a) occupiedSheet(a);
  else emptySheet(table, chair);
}
function emptySheet(table, chair) {
  const candidates = unassignedPeople();
  openSheet(
    `<h2>${esc(table.name)} · chair ${chair.seatNumber}</h2><p class=muted>Choose an unassigned person.</p><input class=search id=candidateSearch placeholder="Search guests" autofocus><div id=candidates>${candidateMarkup(candidates, table.id, chair.id)}</div><button class=btn data-close>Cancel</button>`,
  );
  document.querySelector("#candidateSearch").addEventListener("input", (e) => {
    document.querySelector("#candidates").innerHTML = candidateMarkup(
      candidates.filter((x) =>
        `${x.guest.fullName} ${x.guest.side} ${x.label}`
          .toLowerCase()
          .includes(e.target.value.toLowerCase()),
      ),
      table.id,
      chair.id,
    );
  });
}
function candidateMarkup(list, tableId, chairId) {
  return list.length
    ? list
        .map(
          (p) =>
            `<button class=candidate data-assign data-guest-id="${esc(p.guest.id)}" data-index="${p.index}" data-table-id="${esc(tableId)}" data-chair-id="${esc(chairId)}"><b>${esc(p.guest.fullName || "Guest")} · ${esc(p.label)}</b><small>${esc(p.guest.side || "family")} · ${esc(p.guest.rsvpStatus || "pending")}</small></button>`,
        )
        .join("")
    : `<div class=empty>Everyone already has a chair.</div>`;
}
function occupiedSheet(a) {
  openSheet(
    `<h2>${esc(personName(a))}</h2><p class=muted>${esc(a.tableName)} · chair ${a.seatNumber}</p><div class=toolbar><button class="btn primary" data-move>Move to empty chair</button><button class=btn data-swap>Swap with chair</button><button class="btn danger" data-unassign>Unassign</button><button class=btn data-close>Close</button></div>`,
  );
  modalRoot.querySelector("[data-move]").onclick = () => {
    state.action = { type: "move", assignment: a };
    closeSheet();
    toast("Tap an empty destination chair.");
  };
  modalRoot.querySelector("[data-swap]").onclick = () => {
    state.action = { type: "swap", assignment: a };
    closeSheet();
    toast("Tap the occupied chair to swap.");
  };
  modalRoot.querySelector("[data-unassign]").onclick = () => confirmUnassign(a);
}
function unassignedPeople() {
  const taken = new Set(
    assignments().map((a) => `${a.guestId}:${a.personKey}`),
  );
  return state.guests
    .flatMap((g) =>
      Array.from({ length: partySize(g) }, (_, index) => ({
        guest: g,
        index,
        label: personLabel(index),
      })),
    )
    .filter((p) => !taken.has(`${p.guest.id}:${personKey(p.index)}`));
}
function confirmUnassign(a) {
  openSheet(
    `<h2>Unassign ${esc(personName(a))}?</h2><p class=muted>This removes only this person from ${esc(a.tableName)} chair ${a.seatNumber}.</p><div class=toolbar><button class="btn danger" data-confirm>Unassign</button><button class=btn data-close>Cancel</button></div>`,
  );
  modalRoot.querySelector("[data-confirm]").onclick = () =>
    mutate("unassign", a);
}
function openSheet(content) {
  modalRoot.innerHTML = `<div class=sheet-backdrop role=presentation><section class=sheet role=dialog aria-modal=true>${content}</section></div>`;
  modalRoot
    .querySelector("[data-close]")
    ?.addEventListener("click", closeSheet);
  modalRoot
    .querySelectorAll("[data-assign]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          mutate(
            "assign",
            {
              guestId: b.dataset.guestId,
              partyMemberIndex: Number(b.dataset.index),
              personKey: personKey(b.dataset.index),
            },
            { tableId: b.dataset.tableId, chairId: b.dataset.chairId },
          )),
    );
  modalRoot.querySelector("input,button")?.focus();
}
function closeSheet() {
  modalRoot.innerHTML = "";
}

async function mutate(type, source, destination = {}) {
  if (state.pending) return;
  state.pending = true;
  render();
  closeSheet();
  try {
    if (demo) {
      mutateDemo(type, source, destination);
      return;
    }
    const change = httpsCallable(state.services.functions, "mutateSideSeating");
    await change({
      weddingId: state.weddingId,
      type,
      source: type === "assign"
        ? { guestId: source.guestId, partyMemberIndex: source.partyMemberIndex }
        : { tableId: source.tableId, chairId: source.chairId },
      destination: type === "unassign" ? {} : {
        tableId: destination.tableId,
        chairId: destination.chairId,
      },
    });
    state.action = null;
    await refreshSideSeatingData();
    toast(type === "swap" ? "Seats swapped." : type === "unassign" ? "Seat unassigned." : "Seating saved.");
  } catch (error) {
    console.error(error?.code || "seating-unavailable");
    toast("Could not save the seating change. Refresh and try again.");
  } finally {
    state.pending = false;
    render();
  }
}
function setAssignment(t, c, a) {
  c.guestId = a.guestId;
  c.status = "assigned";
  c.assignment = {
    tableId: t.id,
    tableName: t.name || "Table",
    seatNumber: Number(c.seatNumber),
    guestId: a.guestId,
    partyMemberIndex: Number(a.partyMemberIndex),
    personKey: a.personKey || personKey(a.partyMemberIndex),
    label: a.label || personLabel(a.partyMemberIndex),
    isMainGuest: Number(a.partyMemberIndex) === 0,
  };
}
function clearAssignment(t, c) {
  c.guestId = "";
  c.assignment = null;
  c.status = "available";
}
function mutateDemo(type, source, destination) {
  const src = source.tableId ? seat(source.tableId, source.chairId) : null,
    dst = destination.tableId
      ? seat(destination.tableId, destination.chairId)
      : null;
  if (type === "swap") {
    const other = assignment(dst.t, dst.c);
    setAssignment(src.t, src.c, other);
    setAssignment(dst.t, dst.c, source);
  } else if (type === "unassign") clearAssignment(src.t, src.c);
  else {
    if (type === "move") clearAssignment(src.t, src.c);
    setAssignment(dst.t, dst.c, source);
  }
  localStorage.setItem(
    "da3wa:demoDashboardState:v4",
    JSON.stringify({ guests: state.guests, tables: state.tables }),
  );
  state.action = null;
  toast("Seating saved.");
}
function seat(tid, cid) {
  const t = state.tables.find((x) => x.id === tid),
    c = t?.chairs.find((x) => x.id === cid);
  return { t, c };
}
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function cap(v) {
  return v[0].toUpperCase() + v.slice(1);
}
function initials(n) {
  return String(n || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
function toast(message) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 3000);
}
function renderError(message) {
  shell.innerHTML = `<section class="card empty"><h1>Seating access unavailable</h1><p>${esc(message)}</p></section>`;
}
