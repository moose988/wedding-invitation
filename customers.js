import * as api from "./firebase-config.js";
import { isPlatformAdmin, assignCustomer } from "./account-access.js";
import { getEventDisplayTitle } from "./event-utils.js";
import { bindPasswordVisibility, hidePasswords } from "./password-visibility.js?v=1";
bindPasswordVisibility(document);

const $ = id => document.getElementById(id);
const state = { services: null, customers: [], events: [], selected: null, pending: new Map() };
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
      if (!await isPlatformAdmin(api, state.services.db, user.uid)) { location.replace("./customer-events.html"); return; }
      $("userEmail").textContent = user.email || "Planner";
      $("loading").hidden = true; $("workspace").hidden = false;
      await load();
    } catch (error) { $("loading").textContent = `Workspace could not load: ${errorText(error)}`; $("status").textContent = `Could not load customers: ${errorText(error)}`; }
  });
}
$("signOut").onclick = async () => { await api.signOut(state.services.auth); location.replace("./dashboard-login.html?message=signed-out"); };
async function load() {
  $("status").textContent = "Loading customers…";
  const { db, auth } = state.services;
  const read = async (label, operation) => { try { return await operation; } catch (error) { throw new Error(`${label}: ${errorText(error)}`); } };
  const [directory, access] = await Promise.all([read("Customer directory", api.getDocs(api.collection(db, "customerDirectory"))), read("Admin event list", api.getDocs(api.collection(db, "users", auth.currentUser.uid, "weddingAccess")))]);
  const events = await Promise.all(access.docs.map(async row => {
    try {
      const member = await api.getDoc(api.doc(db, "weddings", row.id, "dashboardUsers", auth.currentUser.uid));
      if (!member.exists() || member.data().canViewDashboard !== true) return null;
      const event = await api.getDoc(api.doc(db, "weddings", row.id));
      return event.exists() && !event.data().deleting ? { id: row.id, ...event.data() } : null;
    } catch (error) { if (["permission-denied", "not-found"].includes(error.code)) return null; throw error; }
  }));
  state.events = events.filter(Boolean).sort((a,b) => getEventDisplayTitle(a).localeCompare(getEventDisplayTitle(b)));
  state.customers = await Promise.all(directory.docs.map(async row => {
    const index = await read("Customer event assignments", api.getDocs(api.collection(db, "users", row.id, "weddingAccess")));
    const assignments = await Promise.all(index.docs.map(async entry => {
      const member = await read("Customer event membership", api.getDoc(api.doc(db, "weddings", entry.id, "dashboardUsers", row.id)));
      if (!member.exists() || member.data().role !== "customer") return null;
      const known = state.events.find(event => event.id === entry.id);
      return { id: entry.id, name: known ? getEventDisplayTitle(known) : getEventDisplayTitle(entry.data()) };
    }));
    return { id: row.id, email: row.data().email || "Unknown email", events: assignments.filter(Boolean) };
  }));
  state.customers.sort((a,b) => a.email.localeCompare(b.email)); render();
}
function render() {
  const term = $("search").value.trim().toLowerCase();
  const rows = state.customers.filter(row => [row.email, ...row.events.map(e => e.name)].some(value => value.toLowerCase().includes(term)));
  $("status").textContent = `${rows.length} customer${rows.length === 1 ? "" : "s"} shown`;
  $("customerList").innerHTML = rows.length ? rows.map(row => `<article class="customer-card"><div class="customer-identity"><div class="customer-avatar" aria-hidden="true">${escape(row.email.slice(0,1).toUpperCase())}</div><div class="customer-info"><h2>${escape(row.email)}</h2><p>${row.events.length ? `Assigned to ${row.events.length} event${row.events.length === 1 ? "" : "s"}` : "No events assigned"}</p><div class="customer-tags">${row.events.map(e => `<span class="customer-tag">${escape(e.name)}</span>`).join("")}</div></div></div><div class="customer-actions"><button class="secondary-button" data-action="assign" data-id="${escape(row.id)}" type="button">Assign event</button><button class="secondary-button" data-action="password" data-id="${escape(row.id)}" type="button">Change password</button><button class="secondary-button delete-customer" data-action="delete" data-id="${escape(row.id)}" type="button">Delete</button></div></article>`).join("") : `<div class="customer-empty"><strong>${term ? "No matching customers" : "No customers yet"}</strong><p>${term ? "Try another email or event name." : "Add a customer and assign them to an event to get started."}</p></div>`;
}
$("search").oninput = render;
function accountFields() {
  const form = $("customerForm"), isNew = form.elements.account.value === "new";
  $("emailLabel").hidden = !isNew; $("passwordLabel").hidden = !isNew;
  form.elements.email.required = isNew; form.elements.password.required = isNew;
  if (!isNew) { form.elements.password.value = ""; hidePasswords(form); }
}
function openAdd(id = "") {
  const form = $("customerForm"); form.reset(); hidePasswords(form); formError(form, "");
  form.elements.account.innerHTML = '<option value="new">Create a new account</option>' + state.customers.map(row => `<option value="${escape(row.id)}">${escape(row.email)}</option>`).join("");
  form.elements.event.innerHTML = '<option value="">Select an event</option>' + state.events.map(row => `<option value="${escape(row.id)}">${escape(getEventDisplayTitle(row))}</option>`).join("");
  if (id) form.elements.account.value = id;
  accountFields(); $("customerDialog").showModal();
}
$("addCustomer").onclick = () => openAdd(); $("customerForm").elements.account.onchange = accountFields;
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
$("customerList").onclick = event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  state.selected = state.customers.find(row => row.id === button.dataset.id); if (!state.selected) return;
  if (button.dataset.action === "assign") openAdd(state.selected.id);
  if (button.dataset.action === "password") { $("passwordForm").reset(); resetPasswordVisibility(); formError($("passwordForm"), ""); $("passwordFor").textContent = `Set a new password for ${state.selected.email}.`; $("passwordDialog").showModal(); }
  if (button.dataset.action === "delete") { formError($("deleteForm"), ""); $("deleteFor").textContent = state.selected.email; $("deleteDialog").showModal(); }
};
$("customerForm").onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget, wedding = state.events.find(row => row.id === form.elements.event.value);
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
  const token = await state.services.auth.currentUser.getIdToken();
  const response = await fetch("/api/customer-management", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, userId, ...(password ? { password } : {}) }),
  });
  let data; try { data = await response.json(); } catch { throw new Error("Customer account management is not available on this preview."); }
  if (!response.ok) throw new Error(data.error || "The operation could not be completed.");
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
  event.preventDefault(); const form = event.currentTarget; formError(form, "");
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
  event.preventDefault(); const form = event.currentTarget; busy(form, true); formError(form, "");
  try { const email = state.selected.email; await manageAccount("delete", state.selected.id); $("deleteDialog").close(); await load(); $("status").textContent = `${email} was deleted.`; }
  catch (error) { formError(form, `${errorText(error)} If deletion was interrupted, retry it.`); } finally { busy(form, false); }
};
