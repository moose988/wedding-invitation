# Event Invitation Platform

A bilingual invitation and event dashboard built for Firebase Spark using Firebase Authentication, Cloud Firestore, and a Vercel-hosted static frontend. Live browser workflows do not require Cloud Functions, billing, paid APIs, or a local web server. Event IDs are identifiers, not credentials.

See [Administrator and customer access](ACCESS-WORKFLOW.md) for the current authorization, onboarding, local tests, and trusted initial repair.

## Main routes

- `dashboard-login.html` / `all-events.html` — administrator login and event list.
- `customer-login.html` / `customer-events.html` — customer login and assigned-event list.
- `dashboard.html` — event settings, guests, invitations, seating, exports, and organizer actions.
- `index.html` — public guest invitation and RSVP.
- `side.html` — public family summary or an authenticated, side-scoped seating workspace.
- `checkin.html` — authenticated check-in and search.
- `send.html` — delegated WhatsApp sender workflow.

## Access and data model

Event permissions live in `weddings/{eventId}/dashboardUsers/{uid}` and are checked by Firestore rules. Event owners create their root event and owner membership together. Email addresses, URL parameters, browser storage, and UI state do not grant access. Bride/groom links open the email/password sign-in page with event context; after sign-in, `side.html` reads the signed-in UID's membership. Family seating access is read-only. Seating disabled on an event also disables seating reads and writes for side accounts.

The signed-in dashboard uses Firebase `browserSessionPersistence` in the `planner-session` app scope. Public invitations use a separate unauthenticated Firestore app and never sign in or sign out dashboard accounts.

Seating uses layout in `tables`, canonical per-chair assignments in `seatAssignments`, per-person uniqueness bindings in `seatedPeople`, and PII-free occupied/empty markers in `seatOccupancy`. A Firestore transaction performs each assign, move, swap, or unassign operation. Existing table and chair IDs and coordinates are retained by the owner-run, resumable schema migration.

## Invitations and RSVP

Each guest's invitation token is 256-bit random data generated in the browser and saved to `invitationSecrets`, `invitationTokens`, and an exact-token `publicGuests` projection. Copying an active invitation reuses its token. The URL carries `#guest=<token>&recipient=<guestId>`; RSVP updates the canonical guest and token projection in one Firestore batch, and rules validate the actual additional-guest allowance. Anonymous readers cannot list invitations or read the private guest roster, phone numbers, notes, or account memberships.

Personal invitation data is an exact-token projection. Sanitized shared event details, table geometry, venue objects and schedule items live in `publicEvent`, `publicLayouts`, `publicVenue` and `publicSchedule`; invitation listeners merge them with existing embedded projections. Each schedule item is validated separately to keep a twelve-item schedule within Firestore's evaluation budget. Saved settings/layouts update the same invitation URL without regenerating its token. Anonymous clients never read the private event or roster. Explicit owner repair is bounded and skips unchanged content.

## WhatsApp sender links

Organizers create a random Firestore capability and store only the selected recipients in child documents of at most 20 recipients each. Sender pages read the exact capability and exact chunk documents; anonymous list queries are denied. The recipient records include names, normalized phone numbers, sides, and their invitation URLs. Anyone holding a sender link can see the selected recipient names, phone numbers, and invitation links until an organizer revokes the capability or deletes the event. Links currently have no automatic expiry; revoke them from the dashboard when they are no longer needed. Demo mode may still use a URL-encoded synthetic payload, but live sender links do not contain a base64 roster.

## Check-in and projections

Check-in requires a signed-in event account with `canCheckIn`. Token scanning resolves a current invitation through the private token index, then reads the side-scoped `checkinGuests` projection. The bearer invitation never grants check-in access. Owners maintain `publicSummary`, `publicStats`, and the minimal seating/check-in projections from dashboard writes and can run **Repair projections** for an existing event. Public summaries contain counts only and show their last-updated time; projected values may lag until an authorized owner session refreshes them.

## Local setup and tests

Install Node.js 22 or newer, Java 21 or newer, and the Firebase CLI. In Windows PowerShell:

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/` (customer sign-in) or `http://127.0.0.1:5173/dashboard-login.html` (administrator sign-in). The local preview serves the existing HTML routes and Firebase-backed navigation without changing the app's live project configuration. **The preview defaults to live Firebase: saves, event creation, RSVP submissions, and other writes affect live data.** A persistent banner identifies the active mode and links to the other mode.

To use isolated local demo data instead, stop the live preview and run:

```powershell
npm run dev:emulator
```

Then open `http://127.0.0.1:5173/customer-login.html?emulator=1`. This starts Firebase Auth and Firestore emulators for `demo-wedding-security` on `127.0.0.1:9099` and `127.0.0.1:8080`; the app's local-only guard routes Firebase traffic there. Emulator writes stay local. Seed the synthetic demo accounts/events in a second terminal with `npm run seed:local`; optional guest/table fixtures are available with `node scripts/seed-local-access.mjs --fixtures`. Example login: `admin@example.test` / `emulator-only`. Stop the preview and emulators with Ctrl+C.

Other existing local testing commands:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
npm run test:security
```

The security command starts only the Firestore emulator. It does not connect to or modify production data. For mobile layout review, open the same local URL in a browser and use its device/mobile viewport preview; the pages load their responsive styles at narrow screen widths.

## Firebase Console setup and deployment

1. Confirm the project is on the Spark plan and Cloud Firestore is initialized. Firebase Hosting is not used for production.
2. In Firebase Console → Authentication → Sign-in method, enable **Email/Password**. Provision the protected platform administrator through trusted IAM tooling, then use Event Settings → **Customer access** to create/link customers.
3. Sign in to the Firebase CLI and select the intended project:

```powershell
firebase login
firebase use weddinginvitaion-b4f36
```

4. Deploy only the Firestore rules and index configuration to Firebase:

```powershell
firebase deploy --only firestore:rules,firestore:indexes --project weddinginvitaion-b4f36
```

The reported production alias `https://wedding-invitation-ebon-three.vercel.app/` belongs to Vercel project **`wedding-invitation`**, connected to `moose988/wedding-invitation` on `main` (verified October 18, 2026). The local ignored `.vercel` binding and older references to `wedding-invitation-nlsf` identify a different project. Verify the alias, deployment source commit, and `access-release.json` after release. Do not deploy Firebase Hosting or Functions. Firestore rules deploy separately from Vercel.

Opening dashboards and navigating do not write or migrate records. A relevant save publishes only affected data; the first explicit layout save initializes sanitized shared geometry (bounded to 200 tables). **Repair projections** is an explicit owner action: at most 50 guests per click, continuing from an in-memory cursor. It preserves tokens and skips unchanged content. Older seating schemas retain their placements; projection repair does not migrate them. Wait for quota availability before retrying a failed publication; **Refresh** retries pending work once.
