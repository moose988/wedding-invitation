// Who has access to one event, in the words an administrator reads. No Firebase and no DOM,
// so it runs in Node tests. Memberships are the documents in weddings/{id}/dashboardUsers.
const SIDES = { bride: "bride side", groom: "groom side", family: "family side" };

// label says what the person can do; removable is true only for customers, because the server
// refuses to unlink owners and staff here (their access is managed inside the event dashboard).
export function describeMember(member, ownerUserId) {
  const side = SIDES[member.allowedSide] ? `, ${SIDES[member.allowedSide]}` : "";
  if (member.id === ownerUserId || member.role === "owner") return { kind: "owner", label: "Owner", note: "An admin. Owners cannot be removed.", removable: false };
  if (member.role === "customer") return { kind: "customer", label: "Customer", note: "Guests, seating, event details and exports.", removable: true };
  if (member.seatingOnly === true) return { kind: "staff", label: `Seating only${side}`, note: "Managed in the event dashboard.", removable: false };
  if (member.canCheckIn === true && member.canViewDashboard !== true) return { kind: "staff", label: `Check-in${side}`, note: "Managed in the event dashboard.", removable: false };
  return { kind: "staff", label: member.role === "admin" ? "Admin" : "Staff", note: "Managed in the event dashboard.", removable: false };
}

const ORDER = { owner: 0, customer: 1, staff: 2 };
export function accessRows(members, ownerUserId) {
  return members
    .map((member) => ({ id: member.id, email: typeof member.email === "string" && member.email ? member.email : "", ...describeMember(member, ownerUserId) }))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.email.localeCompare(b.email) || a.id.localeCompare(b.id));
}

export const MIN_NEW_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return EMAIL.test(email) && email.length <= 254 ? email : "";
}

// Users from the directory who could still be added: not already a member, with an email, by email.
export function existingChoices(directory, rows) {
  const members = new Set(rows.map((row) => row.id));
  return directory.filter((row) => row.email && !members.has(row.id)).sort((a, b) => a.email.localeCompare(b.email));
}

// The users whose email contains what was typed, best matches first: emails that start with it, then the rest.
export function searchChoices(choices, term, max = 8) {
  const text = String(term || "").trim().toLowerCase();
  const matches = text ? choices.filter((row) => row.email.toLowerCase().includes(text)) : choices;
  const ranked = text ? [...matches].sort((a, b) => (b.email.toLowerCase().startsWith(text) - a.email.toLowerCase().startsWith(text)) || a.email.localeCompare(b.email)) : matches;
  return { shown: ranked.slice(0, max), more: Math.max(0, ranked.length - max) };
}

// What to do after looking an email up, so the dialog only has to follow it.
export function nextStepFor(lookup, rows) {
  if (!lookup) return { step: "create", message: "No account uses this email yet. Set a first password to create one; the customer signs in with it at Customer sign-in." };
  if (lookup.isAdmin) return { step: "stop", message: "This account is an admin. Admins already have access to every event." };
  if (lookup.disabled) return { step: "stop", message: "This account is disabled, so it cannot be given access." };
  const existing = rows.find((row) => row.id === lookup.uid);
  if (existing) return { step: "stop", message: `This account already has access as ${existing.label}.` };
  return { step: "link", message: "" };
}

// The result of one link or unlink call for one event, as { ok, message }.
export function linkOutcome(response, action) {
  const result = response?.results?.[0];
  if (result?.ok) return { ok: true, message: action === "link" ? "Access given." : "Access removed. The account and its other events are unchanged." };
  const known = { EVENT_NOT_FOUND: "This event no longer exists.", EVENT_DELETING: "This event is being deleted.", EVENT_EXPIRED: "This demo has expired.", PRESERVED_ROLE: "This person is an owner or staff member, so they are not removed here.", NOT_ATTEMPTED: "The server ran out of time. Try again." };
  return { ok: false, message: known[result?.code] || result?.error || "The change could not be saved. Try again." };
}
