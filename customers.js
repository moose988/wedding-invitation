import { CUSTOMER_ADMIN_REDIRECT } from "./customer-list.js";
import * as api from "./firebase-config.js";
import { isPlatformAdmin, assignCustomer } from "./account-access.js";
import { getEventDisplayTitle } from "./event-utils.js";
import { adminPost } from "./admin-api.js";
import { skeleton } from "./skeleton.js";
import { runFromEvent } from "./action-feedback.js";
import { mountAdminHealth } from "./admin-health.js";
import { loadAdminEventsShared } from "./admin-events.js";
import { mountCustomerLink } from "./customer-link.js";
import { createOwnerAdapter } from "./photo-bucket/adapters.js";
import { bindPasswordVisibility, hidePasswords } from "./password-visibility.js?v=1";
bindPasswordVisibility(document);

const $ = id => document.getElementById(id);
const state = { services: null, customers: [], events: [], selected: null, pending: new Map(), cursor: null, more: false, eventsLoaded: false, eventsError: "", eventsTruncated: false };
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const errorText = error => error?.message || error?.code || "Please try again.";
const formError = (form, text) => { form.querySelector(".form-error").textContent = text; };
function busy(form, value) { form.querySelector('[type="submit"]').disabled = value; }

if (!api.isFirebaseConfigured()) $("loading").textContent = "Firebase is not configured.";
else {
  state.services = api.initFirebase();
  api.onAuthStateChanged(state.services.auth, async user => {
    if (!user) { location.replace("./dashboard-login.html?message=session-required"); return; }
    try {
      if (!await isPlatformAdmin(api, state.services.db, user.uid)) { location.replace(CUSTOMER_ADMIN_REDIRECT); return; }
      $("userEmail").textContent = user.email || "Planner";
      $("loading").hidden = true; $("workspace").hidden = false;
      void mountAdminHealth(state.services.auth);
      state.user = user;
      mountCustomerLink({ services: state.services, user });
      await load();
    } catch (error) { $("loading").textContent = `Workspace could not load: ${errorText(error)}`; $("status").textContent = `Could not load customers: ${errorText(error)}`; }
  });
}
$("signOut").onclick = async event => { await runFromEvent(event, async () => { await api.signOut(state.services.auth); location.replace("./dashboard-login.html?message=signed-out"); }, { what: "Signing out", busyLabel: "Signing out…" }); };
// The directory is read one page at a time and each customer's events load only when
// the row is opened, so the page cost does not grow with customers times events.
const PAGE = 50;
async function load(more = false) {
  $("status").textContent = "Loading customers…"; $("loadMore").hidden = true; if (!more) $("customerList").innerHTML = skeleton.rows(4, "Loading customers…");
  const { db } = state.services;
  try {
    const parts = [api.collection(db, "customerDirectory"), ...(more && state.cursor ? [api.startAfter(state.cursor)] : []), api.limit(PAGE)];
    const directory = await api.getDocs(api.query(...parts));
    const rows = directory.docs.map(row => ({ id: row.id, email: row.data().email || "Unknown email", events: null }));
    state.customers = (more ? [...state.customers, ...rows] : rows).sort((a, b) => a.email.localeCompare(b.email));
    state.cursor = directory.docs.at(-1) || state.cursor; state.more = directory.docs.length === PAGE;
    render();
  } catch (error) { $("status").textContent = `Could not load customers: ${errorText(error)}`; $("retryCustomers").hidden = false; $("customerList").innerHTML = ""; return; }
  $("retryCustomers").hidden = true;
  if (!state.eventsLoaded) void loadEventList();
}
async function loadEventList() {
  try {
    const { rows, truncated } = await loadAdminEventsShared(api, state.services.db);
    state.events = rows.filter(e => e.deleting !== true).map(e => ({ id: e.id, ...e })).sort((a, b) => getEventDisplayTitle(a).localeCompare(getEventDisplayTitle(b)));
    state.eventsLoaded = true; state.eventsTruncated = truncated;
    if ($("customerDialog").open) populateCustomerEvents();
  } catch (error) {
    state.eventsError = errorText(error);
    if ($("customerDialog").open) formError($("customerForm"), `The event list could not load (${state.eventsError}). Close and reopen this form to try again.`);
  }
}
async function loadAssignments(customer) {
  const { db } = state.services;
  const index = await api.getDocs(api.collection(db, "users", customer.id, "weddingAccess"));
  const assignments = await Promise.all(index.docs.map(async entry => {
    const member = await api.getDoc(api.doc(db, "weddings", entry.id, "dashboardUsers", customer.id));
    if (!member.exists() || member.data().role !== "customer") return null;
    const known = state.events.find(event => event.id === entry.id);
    return { id: entry.id, name: known ? getEventDisplayTitle(known) : getEventDisplayTitle(entry.data()) };
  }));
  customer.events = assignments.filter(Boolean);
  // Photo buckets are linked on the photo service, not in Firestore, so ask it which buckets this account owns.
  try {
    const buckets = await (await createOwnerAdapter(state.user)).list({ uid: customer.userId || customer.id });
    customer.buckets = buckets.filter(b => b.status !== "deleting" && (b.owners || []).includes(customer.userId || customer.id)).map(b => ({ id: b.id, name: b.name || b.id }));
    customer.bucketError = "";
  } catch (error) { customer.buckets = []; customer.bucketError = `Photo buckets could not load: ${errorText(error)}`; }
}
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function accessSummary(row) {
  if (!row.events) return "Open to see assigned events and photo buckets";
  const parts = [row.events.length && plural(row.events.length, "event"), row.buckets?.length && plural(row.buckets.length, "photo bucket")].filter(Boolean);
  return parts.length ? `Assigned to ${parts.join(" and ")}` : "No events or photo buckets assigned";
}
function render() {
  const term = $("search").value.trim().toLowerCase();
  const rows = state.customers.filter(row => [row.email, ...(row.events || []).map(e => e.name), ...(row.buckets || []).map(b => b.name)].some(value => value.toLowerCase().includes(term)));
  $("status").textContent = `${rows.length} customer${rows.length === 1 ? "" : "s"} shown${state.more ? ". Search covers the customers loaded so far." : ""}`;
  $("loadMore").hidden = !state.more;
  $("customerList").innerHTML = rows.length ? rows.map(row => `<article class="customer-card"><div class="customer-identity"><div class="customer-avatar" aria-hidden="true">${escape(row.email.slice(0,1).toUpperCase())}</div><div class="customer-info"><h2>${escape(row.email)}</h2><p>${escape(accessSummary(row))}</p><div class="customer-tags">${(row.events || []).map(e => `<span class="customer-tag">${escape(e.name)}</span>`).join("")}${(row.buckets || []).map(b => `<span class="customer-tag customer-tag--bucket">Photos · ${escape(b.name)}</span>`).join("")}</div>${[row.error, row.bucketError].filter(Boolean).map(text => `<p class="form-error" role="alert">${escape(text)}</p>`).join("")}</div></div><div class="customer-actions"><button class="secondary-button" data-action="events" data-id="${escape(row.id)}" type="button">${row.events ? "Refresh access" : "Show access"}</button><button class="secondary-button" data-action="link" data-id="${escape(row.id)}" type="button">Link or unlink</button><button class="secondary-button" data-action="password" data-id="${escape(row.id)}" type="button">Change password</button><button class="secondary-button delete-customer" data-action="delete" data-id="${escape(row.id)}" type="button">Delete</button></div></article>`).join("") : `<div class="customer-empty"><strong>${term ? "No matching customers" : "No customers yet"}</strong><p>${term ? "Try another email or event name." : "Add a customer to get started, then link them to events above."}</p></div>`;
}
$("search").oninput = render;
function accountFields() {
  const form = $("customerForm"), isNew = form.elements.account.value === "new";
  $("emailLabel").hidden = !isNew; $("passwordLabel").hidden = !isNew;
  form.elements.email.required = isNew; form.elements.password.required = isNew;
  if (!isNew) { form.elements.password.value = ""; hidePasswords(form); }
}
function openAdd() {
  // Existing accounts are linked from the panel above, so this dialog only creates new accounts.
  const form = $("customerForm"); form.reset(); hidePasswords(form); formError(form, "");
  form.elements.account.innerHTML = '<option value="new">Create a new account</option>';
  populateCustomerEvents();
  accountFields(); $("customerDialog").showModal();
  if (state.eventsError) formError(form, `The event list could not load (${state.eventsError}). Close and reopen this form to try again.`);
  else if (state.eventsTruncated) formError(form, `Only the first ${state.events.length} events are listed. Use the link panel above for others.`);
}
function populateCustomerEvents() {
  const select = $("customerForm").elements.event, selected = select.value;
  select.innerHTML = '<option value="">Select an event</option>' + state.events.map(row => `<option value="${escape(row.id)}">${escape(getEventDisplayTitle(row))}</option>`).join("");
  select.value = selected;
}
$("addCustomer").onclick = () => openAdd(); $("customerForm").elements.account.onchange = accountFields;
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
$("customerList").onclick = async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  state.selected = state.customers.find(row => row.id === button.dataset.id); if (!state.selected) return;
  if (button.dataset.action === "events") {
    button.disabled = true; state.selected.error = "";
    try { await loadAssignments(state.selected); } catch (error) { state.selected.error = `Events could not load: ${errorText(error)}`; }
    render();
  }
  if (button.dataset.action === "link") { $("lookupEmail").value = state.selected.email; $("lookupForm").requestSubmit(); $("linkPanel").scrollIntoView({ block: "start" }); }
  if (button.dataset.action === "password") { $("passwordForm").reset(); resetPasswordVisibility(); formError($("passwordForm"), ""); $("passwordFor").textContent = `Set a new password for ${state.selected.email}.`; $("passwordDialog").showModal(); }
  if (button.dataset.action === "delete") { formError($("deleteForm"), ""); $("deleteFor").textContent = state.selected.email; $("deleteDialog").showModal(); }
};
// After the link panel links or unlinks, refresh that customer's card if it is open, so the change shows at once.
document.addEventListener("customer-access-changed", async event => {
  const row = state.customers.find(c => (c.userId || c.id) === event.detail?.uid);
  if (!row?.events) return;
  try { row.error = ""; await loadAssignments(row); } catch (error) { row.error = `Events could not load: ${errorText(error)}`; }
  render();
});
$("loadMore").onclick = () => load(true);
$("retryCustomers").onclick = () => load();
$("customerForm").onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget, wedding = state.events.find(row => row.id === form.elements.event.value);
  if (form.querySelector('[type="submit"]').disabled) return;
  if (!wedding) { formError(form, "Choose an event."); return; }
  busy(form, true); formError(form, ""); let customer;
  try {
    if (form.elements.account.value === "new") {
      const email = form.elements.email.value.trim().toLowerCase();
      customer = state.pending.get(email) || await api.createIsolatedCustomer(email, form.elements.password.value);
      state.pending.set(email, customer);
    } else customer = state.customers.find(row => row.id === form.elements.account.value);
    if (!customer) throw new Error("Choose a customer account.");
    const userId = customer.userId || customer.id;
    const existing = await api.getDoc(api.doc(state.services.db, "weddings", wedding.id, "dashboardUsers", userId));
    if (existing.exists() && existing.data().role !== "customer") throw new Error("This account already has another role on that event.");
    await assignCustomer(api, state.services.db, wedding.id, wedding, { userId, email: customer.email });
    state.pending.delete(customer.email); form.elements.password.value = ""; $("customerDialog").close(); await load(); $("status").textContent = `Access saved for ${customer.email}.`;
  } catch (error) { formError(form, customer && state.pending.has(customer.email) ? "The account was created, but assignment failed. Submit again to retry." : errorText(error)); }
  finally { busy(form, false); }
};
async function manageAccount(action, userId, password) {
  await adminPost(state.services.auth, "/api/customer-management", { action, userId, ...(password ? { password } : {}) }, undefined, { what: action === "delete" ? "Deleting the customer account" : "Changing the password" });
}
function resetPasswordVisibility() {
  document.querySelectorAll("[data-password-toggle]").forEach(button => {
    const input = $(button.dataset.passwordToggle);
    input.type = "password";
    button.textContent = "Show";
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", input.name === "password" ? "Show new password" : "Show confirmation password");
  });
}
document.querySelectorAll("[data-password-toggle]").forEach(button => button.addEventListener("click", () => {
  const input = $(button.dataset.passwordToggle), showing = input.type === "password";
  input.type = showing ? "text" : "password";
  button.textContent = showing ? "Hide" : "Show";
  button.setAttribute("aria-pressed", String(showing));
  button.setAttribute("aria-label", `${showing ? "Hide" : "Show"} ${input.name === "password" ? "new password" : "confirmation password"}`);
}));
$("passwordForm").onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget; if (form.querySelector('[type="submit"]').disabled) return; formError(form, "");
  if (form.elements.password.value !== form.elements.confirmPassword.value) {
    formError(form, "Passwords do not match. Please try again.");
    form.elements.confirmPassword.focus();
    return;
  }
  busy(form, true);
  try { await manageAccount("password", state.selected.id, form.elements.password.value); form.reset(); $("passwordDialog").close(); $("status").textContent = `Password changed for ${state.selected.email}.`; }
  catch (error) { formError(form, errorText(error)); } finally { busy(form, false); }
};
$("deleteForm").onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget; if (form.querySelector('[type="submit"]').disabled) return; busy(form, true); formError(form, "");
  try { const email = state.selected.email; await manageAccount("delete", state.selected.id); $("deleteDialog").close(); await load(); $("status").textContent = `${email} was deleted.`; }
  catch (error) { formError(form, `${errorText(error)} If deletion was interrupted, retry it.`); } finally { busy(form, false); }
};
