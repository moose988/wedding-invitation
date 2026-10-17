import * as api from "./firebase-config.js";
import { assignCustomer, removeCustomer, issueCustomerGrant } from "./account-access.js";

// A successful Auth creation is retained in memory for a Firestore retry. No
// password is kept here or persisted anywhere.
const createdAccounts = new Map();
const escape = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export async function mountCustomerAccess(container, { db, weddingId, wedding }) {
  if (!container) return;
  container.innerHTML = '<h2>Customer access</h2><p role="status">Loading customer access…</p>';
  try {
    const [directory, memberships, grants] = await Promise.all([
      api.getDocs(api.collection(db, "customerDirectory")),
      api.getDocs(api.collection(db, "weddings", weddingId, "dashboardUsers")),
      api.getDocs(api.query(api.collection(db, "customerGrants"), api.where("weddingId", "==", weddingId))),
    ]);
    if (!container.isConnected) return;
    const customers = memberships.docs.filter((row) => row.data().role === "customer");
    container.innerHTML = `<h2>Customer access</h2><p>Customers can manage all guests and seating, edit event details, and export the guest list.</p>
      <ul>${customers.map((row) => `<li>${escape(row.data().email)} <button type="button" class="text-button" data-remove-customer="${escape(row.id)}">Remove access</button></li>`).join("") || '<li>No customers assigned yet.</li>'}
      ${grants.docs.map((row) => `<li>${escape(row.data().email)} · Awaiting verified sign-in <button type="button" class="text-button" data-remove-grant="${escape(row.id)}">Cancel invitation</button></li>`).join("")}</ul>
      <button class="da3wa-button da3wa-button--secondary" type="button" data-add-customer>Add Customer</button>
      <form class="seating-account-form" data-customer-form hidden>
        <label>Customer account<select name="account"><option value="new">Create a new account</option><option value="pending">Invite an existing account by email</option>${directory.docs.map((row) => `<option value="${escape(row.id)}">${escape(row.data().email)}</option>`).join("")}</select></label>
        <label data-email-label>Email<input name="email" type="email" autocomplete="off" maxlength="254" required /></label>
        <label data-password-label>Initial password<input name="password" type="password" autocomplete="new-password" minlength="6" required /></label>
        <p data-onboarding-note hidden>The existing account must verify its email, then sign in at Customer Access. Linking completes automatically; no UID is needed.</p>
        <button class="da3wa-button da3wa-button--primary" type="submit">Save customer access</button>
      </form><p role="status" data-customer-status></p>`;
    const form = container.querySelector("form");
    const status = container.querySelector("[data-customer-status]");
    container.querySelector("[data-add-customer]").onclick = () => { form.hidden = false; form.elements.account.focus(); };
    form.elements.account.onchange = () => {
      const kind = form.elements.account.value;
      const needEmail = ["new", "pending"].includes(kind);
      container.querySelector("[data-email-label]").hidden = !needEmail;
      form.elements.email.required = needEmail;
      container.querySelector("[data-password-label]").hidden = kind !== "new";
      form.elements.password.required = kind === "new";
      if (kind !== "new") form.elements.password.value = "";
      container.querySelector("[data-onboarding-note]").hidden = kind !== "pending";
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector("[type=submit]");
      if (button.disabled) return;
      button.disabled = true;
      status.textContent = "Saving customer access…";
      const kind = form.elements.account.value;
      const email = form.elements.email.value.trim().toLowerCase();
      let customer = createdAccounts.get(email);
      try {
        if (kind === "pending") {
          await issueCustomerGrant(api, db, weddingId, email);
          status.textContent = "Invitation saved. Access will link after the account verifies its email and signs in.";
        } else {
          if (kind === "new" && !customer) {
            customer = await api.createIsolatedCustomer(email, form.elements.password.value);
            createdAccounts.set(email, customer);
          } else if (kind !== "new") customer = directory.docs.find((row) => row.id === kind)?.data();
          if (!customer) throw new Error("Choose a customer account.");
          form.elements.password.value = "";
          form.elements.password.required = false;
          container.querySelector("[data-password-label]").hidden = true;
          await assignCustomer(api, db, weddingId, wedding, customer);
          createdAccounts.delete(email);
          status.textContent = `Customer access saved for ${customer.email}.`;
        }
        form.reset(); form.hidden = true;
        // Keep the confirmation visible while refreshing the list.
        const message = status.textContent;
        await mountCustomerAccess(container, { db, weddingId, wedding });
        container.querySelector("[data-customer-status]").textContent = message;
      } catch (error) {
        form.elements.password.value = "";
        status.textContent = customer
          ? "The Auth account exists, but event assignment failed. Click Save again to retry linking this account; it will not create another account."
          : error.code === "auth/email-already-in-use"
            ? "This account already exists. Select it from the directory, or choose Invite an existing account by email."
            : `Customer access could not be saved (${error.code || error.message || "unavailable"}).`;
      } finally { button.disabled = false; }
    };
    container.querySelectorAll("[data-remove-customer], [data-remove-grant]").forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          if (button.dataset.removeCustomer) await removeCustomer(api, db, weddingId, button.dataset.removeCustomer);
          else await api.deleteDoc(api.doc(db, "customerGrants", button.dataset.removeGrant));
          await mountCustomerAccess(container, { db, weddingId, wedding });
          container.querySelector("[data-customer-status]").textContent = "This event's access was removed. The account and other events are unchanged.";
        } catch (error) { status.textContent = `Access could not be removed (${error.code || "unavailable"}).`; button.disabled = false; }
      };
    });
  } catch (error) { container.innerHTML = `<h2>Customer access</h2><p role="status">Customer access could not load (${escape(error.code || "unavailable")}).</p>`; }
}
