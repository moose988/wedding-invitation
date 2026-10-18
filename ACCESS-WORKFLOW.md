# Administrator and customer access

The administrator signs in at `dashboard-login.html`; customers sign in at
`customer-login.html` and always land on `customer-events.html`, including when
they have only one event. Both use the existing tab-scoped `planner-session`
Firebase Auth app. Public invitations use the separate unauthenticated app.

## Confirmed production diagnosis

On 17 October 2026, authenticated reads confirmed that the example customer had
an event discovery card and a canonical membership with `seatingOnly: true` and
`canExport: false`. Firestore denied its parent event read. The dashboard then
attempted that denied parent read during bootstrap. Changing the login page
alone could not fix it. Guest edits also depended on owner-only seating/check-in
projection writes. The old account forms used delegated `currentTarget` rather
than the submitted form and saved membership without the other user's private
discovery record. The limited account editor retained old permissions instead
of granting a coherent customer profile.

The event's owner was already the authenticated administrator UID; the
`pending-auth-setup` value remained only in its discovery metadata. Production
had 67 consistent canonical seat assignments/bindings but no schema-completion
marker. No ownership claim is needed or left available in browser rules.

## Authority and discovery

- `platformAdmins/{uid}` with `enabled: true` is trusted platform authorization.
  Every browser write, including administrator writes, is denied. Provision it
  through authenticated project IAM tooling, never an email check or self-claim.
- `weddings/{event}/dashboardUsers/{uid}` is canonical event authorization.
  `role: customer` uses the single profile in `account-access.js`: all guests and
  seating, restricted event details, exports, and five dashboard sections. It
  always uses `allowedSide: all` and `seatingOnly: false`.
- `users/{uid}/weddingAccess/{event}` is only a private discovery hint. Canonical
  authorization is rechecked for every event. Forging a hint cannot grant access.
- `customerDirectory/{uid}` is administrator-readable; it maps known customer
  emails to UIDs. It contains no password or authorization flag.

Existing specialized memberships are preserved unless an administrator explicitly
assigns that account ordinary customer access on an event. Bride, groom and
family labels never narrow an ordinary customer's seating access.

## Customer access management

Event Settings contains one **Customer access** interface. Create a new account
with an initial password, or select a known customer from the private directory.
Auth creation uses a uniquely named Firebase app with in-memory persistence;
the temporary user is signed out and the app deleted. Membership, directory,
and discovery writes are atomic. Success appears after the commit. If assignment
fails after Auth creation, the UI retains only the UID/email in memory and can
retry linking without creating a duplicate or requiring the password again.
After a page reload, use the directory or the existing-account invitation path.

For an existing account outside the directory, choose **Invite an existing
account by email**. Only administrators can issue a fixed customer grant. The
account must verify the matching email and sign in. Redemption atomically binds
the authenticated UID, saves membership/directory/discovery, and consumes the
grant. Unverified or differently addressed users cannot claim it. The empty
customer event list provides verification and refresh controls. Redemption does
not overwrite specialized memberships. Removing a customer deletes only that
event's membership and discovery card, leaving Auth and other events intact.

## Customer writes and public projections

Customers cannot change lifecycle, ownership/category, permissions, QR/seating
switches, invitation schedule/map-embed configuration, or check-in state. Rules
enforce the field allowlist and reject privileged calls even outside the UI.
Account directories, maintenance, sender management, and organizer check-in
remain unavailable to customers.

Guest creation batches canonical and minimal seating/check-in records. Customer
updates use `guest-edit.js` and `dashboard-persistence.js` to synchronize only affected validated derivatives;
they never require an administrator's open dashboard. Public table geometry is
stored separately in `publicLayouts`, with each document checked against its
canonical table. `publicVenue` contains only the canonical venue layout.
`publicSchedule` contains at most twelve individually validated public items;
private schedule metadata is excluded. The reader subscribes to it only when
the event advertises a nonempty shared schedule. Shared event settings retain
compatibility with earlier projections and do not downgrade once upgraded.
Invitation projections validate event fields and guest values against canonical
documents, strip private assignment fields, and retain the existing token and
fragment URL. The public reader supports both existing projections and the new
canonical-layout form. Projection transactions are separated to stay within
Firestore's evaluation budget. Existing guest records are not edited merely by
loading a customer dashboard.

The dashboard and its behavioral tests share `seating-transactions.js`. It
rechecks chair occupancy and per-person bindings in transactions. Empty chairs
that did not change are not rewritten. Eleven-person assignment/unassignment
and competing sessions are covered by emulator tests.

## Trusted initial repair

`scripts/repair-initial-access.mjs` defaults to preflight. It requires the local
Firebase CLI IAM session and the path to the specifically authorized request
containing the test credentials. Passwords are used only in memory for isolated
authentication; they are never printed or persisted. `--apply` writes the narrow
administrator/customer records atomically. `--finalize-seating` may add only the
internal schema marker after validating every canonical seat/person/occupied
binding and confirming no legacy assignments remain in chairs. It does not
write ownership, event details, guests, tables, seat assignments, or tokens.
There is no browser bootstrap or open administrator-claim path.

## Local verification

`npm test` runs the unit and contract suites. `npm run test:security` starts the
Firestore emulator and runs all five behavioral security files. Their demo
project IDs are separate from the browser fixtures.

For browser mutation tests, run Auth and Firestore emulators with project
`demo-wedding-security`, explicitly set both `FIRESTORE_EMULATOR_HOST` to
`127.0.0.1:8080` and `FIREBASE_AUTH_EMULATOR_HOST` to `127.0.0.1:9099`, then run
`npm run seed:local` (optional `-- --fixtures`). The seed refuses any other hosts.
Use a loopback static server and open the login with `?emulator=1`. Only loopback
hosts honor this option, and it forces a demo project. Copied local test links
carry the same option. No seed script can default to production.

For the three-regression browser matrix, use `node scripts/seed-local-regressions.mjs`
with both loopback environment variables above. It creates only synthetic demo
events (30 and 300 guests), legacy records, eleven-person seating, and existing
embedded invitation fixtures. Random synthetic capability URLs stay in the
ignored `.local-evidence/browser-fixtures.json`. Do not run this script against
production. Local diagnostic counters/failure injection are enabled only by
the loopback `?emulator=1` option; they record counts, not document contents.

Production data audit scripts record counts and hashes only. Deployment must
remain Firestore rules/indexes plus the existing Git-connected Vercel frontend;
Firebase billing, Functions, and paid services are unnecessary.
