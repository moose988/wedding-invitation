# Event Invitation Platform

A bilingual event dashboard and digital invitation app backed by Firebase
Authentication, Cloud Firestore, and Cloud Functions. Event IDs remain readable;
they are identifiers, not credentials.

## Main routes

- `all-events.html` — events available to the signed-in dashboard account.
- `dashboard.html` — event settings, guests, invitations, seating, exports, and
  organizer actions.
- `index.html` — guest invitation and RSVP.
- `side.html` — public aggregate status page or authenticated seating view,
  depending on the route and account.
- `checkin.html` — authenticated check-in and search.
- `send.html` — delegated WhatsApp sender workflow.

Invitation designs are code-owned. The shared invitation data module loads a
server-projected guest and event; individual designs do not read Firestore
collections directly.

## Access model

| Principal | Access |
| --- | --- |
| Event owner | Event settings, guests, invitations, users, exports, seating, check-in, and deletion. |
| Dashboard member | Only the event permissions in `weddings/{eventId}/dashboardUsers/{uid}`. |
| Seating-only member | Assigned side through server-checked seating operations; cannot edit guests or check in. |
| Seating editor link | One event and role, exchanged for a versioned Firebase custom token; revocation is checked on data access. |
| Guest invitation holder | One event and guest invitation; may view the projected invitation and submit RSVP. |
| Check-in member | Search or scan only for the allowed side and update check-in fields only. |
| Public family page | Event title and aggregate counts from `publicSummary/summary`. |
| Demo mode | Synthetic fixture data in the browser; it does not fall through to live Firebase data. |

The WhatsApp sender link is a separate, 24-hour delegated capability. Its URL
contains only a random token; the server rechecks the creator's event
permission and the selected invitations each time the page opens or refreshes.
Organizers can revoke a sender capability. Anyone holding it can see the
selected names and phone numbers and share those invitations until expiry or
revocation. Encoded roster payloads work only for explicit synthetic demo
routes. See [SECURITY.md](./SECURITY.md).

## Invitation access

Live guest links use a 256-bit random token in the URL fragment:

```text
index.html?wedding={readableEventId}#guest={43-character-token}
```

The raw token is not stored in the guest document. Cloud Functions store a
SHA-256 lookup digest and an AES-GCM encrypted owner-recovery copy in
server-only collections. The invitation callable verifies token format,
purpose, event, guest, active status, version, and expiry on every read and
RSVP. RSVP writes only the allowed RSVP fields and enforces that guest's actual
additional-guest allowance. Invitation access does not authorize check-in,
seating, or dashboard access.

Organizers can reuse the same active link from the dashboard. Revocation removes
its lookup record; regeneration issues a new token and invalidates the old one.
Tokens expire 90 days after the event date, or earlier when an event is
completed or deleted. Old legacy links are not accepted as a fallback.

The guest projection includes event invitation content and the seat-map data
needed by the invitation. It excludes the guest's phone number, internal guest
ID, other guests, member permissions, and raw token records. The public family
page is a separate aggregate projection.

## Firebase data

Dashboard data lives under:

```text
weddings/{eventId}
weddings/{eventId}/guests/{guestId}
weddings/{eventId}/tables/{tableId}
weddings/{eventId}/dashboardUsers/{uid}
weddings/{eventId}/seatingAccess/{role}
weddings/{eventId}/publicSummary/summary
```

Private invitation records live in server-only top-level collections:

```text
invitationSecrets/{hashedEventGuestKey}
invitationAccessTokens/{sha256Token}
invitationRateLimits/{windowAndHmacIp}
senderSessions/{sha256Token}
checkinRosterRateLimits/{windowAndHashedUidEvent}
```

Firestore rules deny client access to those collections. Public reads of full
events, guest documents, tables, old guest mirrors, and `publicStats` are denied.
Sensitive callable responses also carry `Cache-Control: no-store`; the Functions
emulator suite verifies this response header.

## Local setup and checks

Use Node.js 22 or newer. Firestore, Auth, Functions, and Hosting emulator runs
also require Java 21 or newer.

```powershell
npm ci
npm --prefix functions ci
node --test
firebase emulators:exec --only firestore --project demo-wedding-security "node --test --test-reporter=tap tests/event-settings-firestore.test.mjs tests/firestore-security.test.mjs"
npm run test:functions
npm audit
npm audit --prefix functions
```

The Functions emulator runner creates a short-lived local encryption key for
tests, then removes it. Never replace an existing `functions/.secret.local`
file automatically. The emulator fixtures use synthetic events and accounts.

Run the Hosting header release gate after deploying to a non-production test
site by setting `HOSTING_SECURITY_TEST_URL` to its base URL, then running:

```powershell
$env:HOSTING_SECURITY_TEST_URL = "https://your-test-site.web.app"
node --test tests/hosting-headers.test.mjs
```

## Deployment

Deployment order, migration gates, backups, rollback boundaries, and the
current readiness assessment are in [RELEASE.md](./RELEASE.md). Do not deploy
the rules before the compatible Functions and Hosting client are available.
Never deploy permissive rules as a compatibility bridge.

Required server-only secrets:

```text
INVITATION_TOKEN_ENCRYPTION_KEY
SEATING_LINK_ENCRYPTION_KEY
```

Use different random values with at least 32 bytes of entropy. Configure them
through Firebase Secret Manager; do not put them in browser config, source,
logs, or test reports. Firebase Web API configuration in `firebase-config.js`
is public client configuration, not a service-account credential.

## Event categories

Events use `eventCategory: "wedding_engagement" | "celebration"`. Wedding
events keep Bride/Groom sides; celebration guests use `side: "general"`.
Missing event categories remain compatible as wedding events. See
`event-utils.js` and the event settings in the dashboard for the canonical
schema.
