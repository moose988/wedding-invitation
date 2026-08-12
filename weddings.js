import { collection, doc, getDocs, initFirebase, isFirebaseConfigured, onAuthStateChanged, onSnapshot, query, serverTimestamp, setDoc, signOut, updateDoc, where, writeBatch, httpsCallable } from "./firebase-config.js";

const state = { services: null, user: null, weddings: [], filter: "all", editId: "", deleteId: "", unsubscribe: null };
const el = Object.fromEntries(["workspace","loadingState","userEmail","signOutButton","createWeddingButton","searchInput","sortSelect","filterRow","workspaceStatus","weddingGrid","emptyState","weddingDialog","weddingForm","formKicker","formTitle","formError","saveWeddingButton","deleteDialog","deleteForm","deletePhrase","deleteConfirmation","deleteError"].map((id) => [id, document.getElementById(id)]));

init();
function init() {
  if (!isFirebaseConfigured()) return showFatal("Firebase is not configured. Add your Firebase configuration before opening the workspace.");
  state.services = initFirebase();
  el.signOutButton.addEventListener("click", async () => { await signOut(state.services.auth); location.replace("./dashboard-login.html?message=signed-out"); });
  el.createWeddingButton.addEventListener("click", () => openForm());
  document.querySelectorAll("[data-create-wedding]").forEach((button) => button.addEventListener("click", () => openForm()));
  el.searchInput.addEventListener("input", render); el.sortSelect.addEventListener("change", render);
  el.filterRow.addEventListener("click", (event) => { const button = event.target.closest("[data-filter]"); if (!button) return; state.filter = button.dataset.filter; document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("is-active", item === button)); render(); });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  el.weddingForm.addEventListener("submit", saveWedding); el.deleteForm.addEventListener("submit", deleteWedding);
  el.weddingGrid.addEventListener("click", handleCardAction);
  onAuthStateChanged(state.services.auth, (user) => { if (!user) return location.replace("./dashboard-login.html?message=session-required"); state.user = user; el.userEmail.textContent = user.email || "Planner"; el.loadingState.hidden = true; el.workspace.hidden = false; watchWorkspace(); });
}

function showFatal(message) { el.loadingState.textContent = message; }
function watchWorkspace() {
  state.unsubscribe?.();
  const access = collection(state.services.db, "users", state.user.uid, "weddingAccess");
  state.unsubscribe = onSnapshot(access, async (snapshot) => {
    state.weddings = snapshot.docs.map((row) => ({ id: row.id, ...row.data() }));
    // Merge in pre-workspace weddings on every load. An account can already
    // have newer indexed weddings, so only falling back for an empty index
    // would hide an older event such as Laila & Zaid.
    await loadLegacyActiveWeddings();
    await enrichStats(); render();
  }, async (error) => {
    // Existing deployments may not yet have the new `/users/{uid}/weddingAccess`
    // rule. Keep established active weddings usable while the rules rollout is
    // completed, instead of leaving the whole workspace blank.
    if (error.code === "permission-denied") {
      state.weddings = [];
      await loadLegacyActiveWeddings();
      await enrichStats();
      render();
      el.workspaceStatus.textContent = state.weddings.length
        ? "Showing existing weddings. Deploy the updated Firestore rules to enable the workspace index."
        : "No accessible weddings were found. Deploy the updated Firestore rules, then refresh.";
      return;
    }
    console.error(error);
    el.workspaceStatus.textContent = "We could not load your wedding workspace. Please refresh and try again.";
  });
}

async function loadLegacyActiveWeddings() {
  try {
    const snapshot = await getDocs(query(collection(state.services.db, "weddings"), where("status", "==", "active")));
    const indexedIds = new Set(state.weddings.map((wedding) => wedding.id));
    const legacy = snapshot.docs.map((row) => ({ id: row.id, ...row.data(), legacy: true }));
    state.weddings = [...state.weddings, ...legacy.filter((wedding) => !indexedIds.has(wedding.id))];
    // Backfill only records missing from the index. This is safe for a signed
    // in dashboard member and avoids repeatedly writing on snapshot updates.
    await Promise.all(legacy.filter((wedding) => !indexedIds.has(wedding.id)).map((wedding) =>
      setDoc(doc(state.services.db, "users", state.user.uid, "weddingAccess", wedding.id), {
        ...indexData(wedding), weddingId: wedding.id, ownerUserId: wedding.ownerUserId || "",
        createdAt: wedding.createdAt || serverTimestamp(), updatedAt: wedding.updatedAt || serverTimestamp(),
      }).catch((error) => console.warn("Could not index legacy wedding", error))));
  } catch (_) { /* An empty workspace is correct when no accessible legacy records exist. */ }
}

async function enrichStats() {
  await Promise.all(state.weddings.map(async (wedding) => {
    try {
      const guests = await getDocs(collection(state.services.db, "weddings", wedding.id, "guests"));
      const rows = guests.docs.map((row) => row.data());
      wedding.stats = { total: rows.length, confirmed: rows.filter((g) => g.rsvpStatus === "confirmed").length, pending: rows.filter((g) => !["confirmed", "declined"].includes(g.rsvpStatus)).length, declined: rows.filter((g) => g.rsvpStatus === "declined").length, checkedIn: rows.filter((g) => g.checkedIn).length };
    } catch (_) { wedding.stats = wedding.stats || { total: 0, confirmed: 0, pending: 0, declined: 0, checkedIn: 0 }; }
  }));
}

function render() {
  const term = el.searchInput.value.trim().toLowerCase();
  let rows = state.weddings.filter((w) => (state.filter === "all" ? w.status !== "archived" : w.status === state.filter) && `${w.coupleName || ""} ${w.brideName || ""} ${w.groomName || ""} ${w.venueEn || ""}`.toLowerCase().includes(term));
  const sortKey = el.sortSelect.value === "event" ? "eventDateISO" : el.sortSelect.value === "updated" ? "updatedAt" : "createdAt";
  rows.sort((a,b) => timestampValue(b[sortKey]) - timestampValue(a[sortKey]));
  el.workspaceStatus.textContent = state.weddings.length ? `${rows.length} wedding${rows.length === 1 ? "" : "s"} shown` : "";
  el.emptyState.hidden = Boolean(state.weddings.length || term || state.filter !== "all");
  el.weddingGrid.innerHTML = rows.map(card).join("");
}

function card(w) {
  const stats = w.stats || {}; const active = ["active", "completed"].includes(w.status); const isOwner = w.ownerUserId === state.user?.uid;
  const ownerActions = isOwner ? `<div class="menu-wrap"><button data-action="menu" data-id="${w.id}" type="button" aria-label="More actions">More</button><div class="action-menu" id="menu-${w.id}" hidden><button data-action="edit" data-id="${w.id}" type="button">Edit details</button><button data-action="duplicate" data-id="${w.id}" type="button">Duplicate setup</button><button data-action="archive" data-id="${w.id}" type="button">${w.status === "archived" ? "Restore wedding" : "Archive wedding"}</button><button class="menu-delete" data-action="delete" data-id="${w.id}" type="button">Delete wedding</button></div></div>` : "";
  return `<article class="wedding-card"><div class="card-head"><div><p class="workspace-kicker">${escape(w.venueEn || "Venue not set")}</p><h2>${escape(w.coupleName || `${w.brideName || "Bride"} & ${w.groomName || "Groom"}`)}</h2></div><span class="status-badge status-badge--${escape(w.status || "draft")}">${escape(w.status || "draft")}</span></div><div class="card-meta">${formatEvent(w.eventDateISO)}${w.location ? ` · ${escape(w.location)}` : ""}</div><div class="card-stats"><span class="stat"><strong>${stats.total || 0}</strong> guests</span><span class="stat"><strong>${stats.confirmed || 0}</strong> confirmed</span><span class="stat"><strong>${stats.pending || 0}</strong> pending</span><span class="stat"><strong>${stats.declined || 0}</strong> declined</span>${active ? `<span class="stat"><strong>${stats.checkedIn || 0}/${stats.total || 0}</strong> checked in</span>` : ""}</div><div class="card-footer"><span>Updated ${formatRelative(w.updatedAt || w.createdAt)}</span></div><div class="card-actions"><button class="open-button" data-action="open" data-id="${w.id}" type="button">Open dashboard</button><button data-action="copy" data-id="${w.id}" type="button" title="Copy invitation base link">Copy link</button>${ownerActions}</div></article>`;
}

async function handleCardAction(event) {
  const button = event.target.closest("[data-action]"); if (!button) return; const wedding = state.weddings.find((w) => w.id === button.dataset.id); if (!wedding) return;
  if (button.dataset.action === "menu") { const menu = document.getElementById(`menu-${wedding.id}`); document.querySelectorAll(".action-menu").forEach((m) => { if (m !== menu) m.hidden = true; }); menu.hidden = !menu.hidden; return; }
  if (button.dataset.action === "open") { localStorage.setItem("da3wa:lastDashboardWeddingId", wedding.id); location.href = `./dashboard.html?wedding=${encodeURIComponent(wedding.id)}`; }
  if (button.dataset.action === "copy") { await navigator.clipboard.writeText(new URL(`index.html?wedding=${encodeURIComponent(wedding.id)}&guest={guestToken}`, location.href)); flash("Guest invitation base link copied."); }
  if (button.dataset.action === "edit") openForm(wedding);
  if (button.dataset.action === "archive") await setArchived(wedding);
  if (button.dataset.action === "duplicate") await duplicate(wedding);
  if (button.dataset.action === "delete") openDelete(wedding);
}

function openForm(wedding) { state.editId = wedding?.id || ""; el.weddingForm.reset(); el.formError.textContent = ""; el.formKicker.textContent = wedding ? "Wedding details" : "New wedding"; el.formTitle.textContent = wedding ? "Edit wedding" : "Create a wedding"; el.saveWeddingButton.textContent = wedding ? "Save changes" : "Create wedding"; if (wedding) { const f = el.weddingForm.elements; ["brideName","groomName","venueEn","location","mapsUrl","whatsAppCountryCode","invitationLanguage","status","plannerNotes"].forEach((key) => f[key].value = wedding[key] || ""); const date = new Date(wedding.eventDateISO); if (!Number.isNaN(+date)) { f.eventDate.value = date.toISOString().slice(0,10); f.eventTime.value = date.toTimeString().slice(0,5); } } el.weddingDialog.showModal(); }
async function saveWedding(event) { event.preventDefault(); const f = el.weddingForm.elements; const brideName = f.brideName.value.trim(), groomName = f.groomName.value.trim(); const eventDateISO = new Date(`${f.eventDate.value}T${f.eventTime.value}`).toISOString(); const data = { brideName, groomName, coupleName: `${brideName} & ${groomName}`, eventDateISO, venueEn: f.venueEn.value.trim(), location: f.location.value.trim(), mapsUrl: f.mapsUrl.value.trim(), whatsAppCountryCode: f.whatsAppCountryCode.value.trim(), invitationLanguage: f.invitationLanguage.value, plannerNotes: f.plannerNotes.value.trim(), status: f.status.value, updatedAt: serverTimestamp() }; el.formError.textContent = ""; el.saveWeddingButton.disabled = true;
  try { if (state.editId) { await updateDoc(doc(state.services.db,"weddings",state.editId), data); await setDoc(doc(state.services.db,"users",state.user.uid,"weddingAccess",state.editId), { ...indexData(data), weddingId: state.editId }, { merge:true }); } else { const weddingRef = doc(collection(state.services.db,"weddings")); const batch = writeBatch(state.services.db); batch.set(weddingRef, { ...data, ownerUserId:state.user.uid, createdAt:serverTimestamp() }); batch.set(doc(state.services.db,"weddings",weddingRef.id,"dashboardUsers",state.user.uid), { email:state.user.email || "", canViewDashboard:true, canEditGuests:true, canEditSeating:true, canCheckIn:true, canManageUsers:true, role:"owner", createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); batch.set(doc(state.services.db,"users",state.user.uid,"weddingAccess",weddingRef.id), { ...indexData(data), weddingId:weddingRef.id, ownerUserId:state.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); await batch.commit(); } el.weddingDialog.close(); } catch (error) { console.error(error); el.formError.textContent = "We could not save this wedding. Please check your access and try again."; } finally { el.saveWeddingButton.disabled=false; } }
function indexData(data) { return { coupleName:data.coupleName, brideName:data.brideName, groomName:data.groomName, eventDateISO:data.eventDateISO, venueEn:data.venueEn, location:data.location, status:data.status, updatedAt:data.updatedAt }; }
async function setArchived(wedding) { const status = wedding.status === "archived" ? "draft" : "archived"; try { await updateDoc(doc(state.services.db,"weddings",wedding.id), { status, updatedAt:serverTimestamp() }); await setDoc(doc(state.services.db,"users",state.user.uid,"weddingAccess",wedding.id), { status, updatedAt:serverTimestamp() }, {merge:true}); } catch (_) { flash("We could not update this wedding. Please try again."); } }
async function duplicate(wedding) { const { id, stats, legacy, createdAt, updatedAt, ...source } = wedding; const copy = { ...source, coupleName:`${wedding.coupleName || "Wedding"} (Copy)`, status:"draft", ownerUserId:state.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }; try { const ref = doc(collection(state.services.db,"weddings")); const batch = writeBatch(state.services.db); batch.set(ref, copy); batch.set(doc(state.services.db,"weddings",ref.id,"dashboardUsers",state.user.uid), { email:state.user.email || "", canViewDashboard:true, canEditGuests:true, canEditSeating:true, canCheckIn:true, canManageUsers:true, role:"owner", createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); batch.set(doc(state.services.db,"users",state.user.uid,"weddingAccess",ref.id), { ...indexData(copy), weddingId:ref.id, ownerUserId:state.user.uid, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }); await batch.commit(); flash("Wedding setup duplicated as a draft."); } catch (e) { console.error(e); flash("We could not duplicate this wedding."); } }
function openDelete(wedding) { state.deleteId=wedding.id; el.deletePhrase.textContent=`DELETE ${wedding.id}`; el.deleteConfirmation.value=""; el.deleteError.textContent=""; el.deleteDialog.showModal(); }
async function deleteWedding(event) { event.preventDefault(); const phrase=`DELETE ${state.deleteId}`; if (el.deleteConfirmation.value !== phrase) { el.deleteError.textContent=`Type “${phrase}” exactly to delete.`; return; } try { await httpsCallable(state.services.functions,"deleteWedding")({ weddingId:state.deleteId, confirmation:phrase }); el.deleteDialog.close(); } catch (error) { console.error(error); el.deleteError.textContent="We could not delete this wedding. Only its owner can do this."; } }
function timestampValue(value) { return value?.toMillis?.() || value?.seconds * 1000 || (value ? new Date(value).getTime() : 0); } function formatEvent(value) { const date=new Date(value); return Number.isNaN(+date) ? "Event date to be set" : new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date); } function formatRelative(value) { const ms=Date.now()-timestampValue(value); if (!ms) return "just now"; const days=Math.floor(ms/86400000); return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`; } function escape(value) { const node=document.createElement("span"); node.textContent=value; return node.innerHTML; } function flash(message) { el.workspaceStatus.textContent=message; }
