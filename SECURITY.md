# Security review and data flow

Assessment date: 2026-10-16. This report covers the repository changes and
local emulator results. It is not a claim that the production service is fully
secure.

## Role and action matrix

| Action | Owner | Guest editor | Seating-only member | Check-in member | Guest token | Public family |
| --- | --- | --- | --- | --- | --- | --- |
| Read full event settings | Yes | Only with event view permission | No | No | No | No |
| Read guest roster | Yes | With guest permission | Only allowed-side projection | Allowed-side check-in projection | One guest projection | No |
| Create/edit/delete guests | Yes | With guest permission | No | No | No | No |
| Read/change seating | Yes | With seating permission | Allowed side via Functions | No | Own assignment in invitation | No |
| Read/reveal invitation link | Yes | With guest permission | No | No | Own link only | No |
| RSVP | No special path | No special path | No | No | Own guest, RSVP fields only | No |
| Check in | Yes | Only if separately granted | No | Allowed side, check-in fields only | No | No |
| Manage dashboard roles | Yes | Only with user-management permission | No | No | No | No |
| Read public aggregate counts | Yes | Yes | Yes | Yes | No | Yes |

Permissions are tied to Firebase Auth UID and the event's
`dashboardUsers/{uid}` document. Email addresses are not role identifiers.
Full-dashboard access and side-only access use separate checks. Custom seating
link claims are additionally checked against a live, versioned
`seatingAccess/{role}` record.

## Data-flow map

1. Dashboard Authentication uses the named `planner-session` Firebase app and
   `browserSessionPersistence`. Seating-link sign-in uses `seating-editor`.
   Public invitation pages initialize Firestore/Functions without initializing
   or changing an Auth session.
2. Guests and event settings are stored in the event's private Firestore
   collections. Firestore rules validate event membership, allowed fields,
   field types, bounds, and role-specific changes.
3. An organizer requests an invitation token through a callable Function.
   The Function creates 32 random bytes, returns unpadded base64url, stores a
   SHA-256 digest for lookup, and stores an AES-GCM encrypted copy in a private
   server-only record. The browser keeps organizer token values in memory,
   keyed by current UID and event.
4. The guest page reads the token from the URL fragment and calls
   `getGuestInvitation`. The Function resolves exactly one event, guest, and
   `guest-invitation` purpose, then returns an explicit field projection.
5. RSVP calls `submitGuestInvitationRsvp`. The Function rechecks token,
   purpose, event lifecycle, version, and allowance in a transaction, and
   changes only RSVP fields. A Firestore trigger rebuilds public aggregate
   counts; emulator tests verify the persisted RSVP and resulting count.
6. Check-in QR resolution and roster search use authenticated Functions that
   recheck `canCheckIn` and `allowedSide` on every request. The roster callable
   returns only check-in fields, is limited to 5,000 guests and four requests
   per account/event per minute, and the client refreshes every 30 seconds.
   Firestore rules allow check-in-role writes only to check-in fields; direct
   guest reads/listing are denied. An invitation token does not grant
   check-in authority.
7. Side seating Functions return a side-redacted map and validate each changed
   assignment against event-local guests, side access, party size, and duplicate
   person assignments. Direct side-only table and guest writes are denied.
8. Public family pages read only `publicSummary/summary`; full events, guest
   records, tables, old token-keyed mirrors, `publicStats`, and invitation
   token records are not public Firestore paths.
9. Callable responses that contain private event, guest, token, or membership
   data set `Cache-Control: no-store`. Live WhatsApp sender pages use a
   separate 24-hour bearer capability. Server records contain selected guest
   IDs and invitation-token digests, not raw tokens or contact data; opening
   and refreshing the page rechecks the creator's permission and each invite.
   Organizers can revoke a sender capability. Sender progress stores numeric
   guest indexes in `sessionStorage` and removes the old event-scoped
   `localStorage` progress record when reopened.

## Findings and disposition

### Fixed in local source; emulator regression coverage passes

| Severity | Finding and evidence | Fix and coverage |
| --- | --- | --- |
| High | The previous rules allowed public reads of active event documents and used a stored guest field comparison as RSVP authority. That comparison did not prove possession of an authorized guest credential. | Direct anonymous event/guest/table and legacy mirror reads and RSVP writes now deny. Callable Functions validate a per-guest capability on every request. Firestore and Functions emulator tests cover anonymous access, malformed/wrong-event tokens, RSVP allowance, persisted changes, revocation, and generic unavailable responses. |
| High | Legacy predictable demo-style guest tokens could address token-keyed public mirrors. | Live invitation access now uses independent random capabilities, private digest lookup, and encrypted recovery records. Migration classifies predictable legacy values without returning them. The synthetic Functions test verifies a `demo-token-1` record is removed and no longer resolves. |
| High | Side-only accounts had direct guest/table paths that could be manipulated outside the allowed side. A previous source rule also relied on an email identity shortcut. | Email-based role checks were removed. Side-only access is based on event membership and `allowedSide`; direct writes deny and the callable checks the side for every affected guest and chair. Emulator tests check cross-side reads/mutations and private-field redaction. |
| High | An invitation link could otherwise be reused as check-in authority. | Check-in resolution requires an authenticated event member with `canCheckIn` and matching side. Rules restrict the write to check-in fields. Tests cover role mismatch and allowed owner check-in. |
| Medium | The invitation details renderer inserted event time, venue, and location values into HTML without escaping. | `renderDetails` now HTML-encodes both the dynamic detail title and value. Output-encoding regression tests cover that sink along with invitation names, dashboard guest IDs, check-in, seating, sender, and event-card render paths. |
| Medium | The WhatsApp sender bundle exposed selected guest names, phone numbers, and invitation bearer tokens in a base64url URL fragment with no expiry or revocation. | Live links now carry only a random 256-bit sender capability. The backend stores a digest, selected guest IDs, and per-invitation token digests, enforces a 24-hour expiry, rechecks creator permission and invite validity, and supports revocation. Functions emulator tests verify side scope, redaction from stored records, expiry, revocation, anonymous bearer access, and `no-store`. Encoded payloads are accepted only on explicit synthetic demo routes. |
| Medium | Spreadsheet exports could interpret guest-provided values as formulas; remote QR rendering could disclose bearer links to a third party. | Export values are neutralized for formula-leading input and QR generation is local. Unit tests cover CSV/XLSX safety and QR generation does not send the link to a third-party QR service. |
| Medium | A collection-group membership query using `documentId()` is invalid for this query shape and could break the workspace list. | The backend now queries a canonical `userId` field with a matching index; an additive, resumable migration prepares old memberships. Functions emulator coverage verifies owner and side-only projections. |

These are local-source fixes. The current production Hosting site has not
received them, and deployed Firestore rules have not been verified from this
environment.

### Remaining before production activation

| Severity | Finding | Evidence / required action |
| --- | --- | --- |
| High | Full-dashboard seating managers can still write table records directly under `canManageSeatingLayout`. The rules do not enforce cross-document capacity, duplicate-chair, or guest/table assignment consistency for every direct table mutation. | Source review: `firestore.rules` permits full-layout writes and `dashboard.js` still uses direct Firestore transactions for several table operations. Route all such mutations through a validated transaction API or add equivalent enforcement, then test capacity, duplicate seats, table moves, deletion, and concurrent changes before production. |
| High | Security headers exist only in local `firebase.json`. The live Hosting site currently responds without CSP, Referrer-Policy, or X-Frame-Options; its HTML cache header is `must-revalidate, no-cache, max-age=0`, not `no-store`. | Read-only HTTP HEAD requests to current `/index.html`, `/dashboard.html`, and `/side.html` returned 200 with those headers absent. Deploy and run `tests/hosting-headers.test.mjs` against the live test release before activation. |
| High | The membership migration production inventory and invitation-token migration inventory have not run. | The membership dry-run stopped before reading data because Google Application Default Credentials are unavailable. The invitation migration was exercised only against synthetic emulator documents. Provide authorized read-only ADC and an owner-authenticated migration session/tool, run dry-run, resolve conflicts/unsupported fields, back up, and record counts before cutover. |
| High | The mandatory two-account, same-browser and separate-browser tests were not run; the supplied account passwords are unavailable in the private session context. | Do not infer roles from `test@gmail.com` or `girl@gmail.com`. An authorized operator must verify each account's actual membership document and perform the eight requested tab/session flows with synthetic data. |
| Medium | Firebase App Check is not enforced, and production Auth settings were not verified. | Function emulator logs showed App Check was absent. Verify authorized domains, email/password settings, account-enumeration protection, admin account protection, and browser guest support for App Check; stage observe-only first, then enforce after validation. App Check is not authorization. |
| Medium | Production API abuse limits, deployed Function response headers, and service-worker behavior were not tested against a deployed version. | No service worker registration was found in source. Public invitation and sender callables are rate-limited by client IP; check-in roster calls are limited to four per account/event per minute. Emulator tests cover rate exhaustion and `Cache-Control: no-store`; deployed behavior still needs staging tests. |
| Medium | Dashboard export buttons use client-side permissions; a full-dashboard account with guest-read permission can still retrieve the guest records through its authorized Firestore client. | Firestore does not provide a field-redacting/export-only boundary while the same client can read the roster. If export restrictions are a security requirement, move roster reads/exports behind server endpoints that enforce distinct permissions. |
| Low / conditional | The Firebase Web config names a Storage bucket, but no Firebase Storage client calls or Storage rules file are present in this repo. | Storage is not used by the inspected app source. If the bucket contains or serves application data, inspect its deployed IAM/Storage Rules before enabling uploads or serving private media. |

## Link-sharing boundary

An individual invitation link is a bearer credential for that guest's
invitation and RSVP. Anyone who receives it can view that invitation and submit
that guest's allowed RSVP fields until expiry or revocation. It does not grant
roster access, seating authority, check-in authority, or organizer access.
An authorized organizer who copies a WhatsApp sender link allows its holder to
view the selected recipients' names and phone numbers and share their
individual invitation links until the 24-hour capability expires or the
organizer revokes it. Refreshes recheck the creator's current event permission
and each invitation's active version. A readable event ID or shared domain is
not authentication.

## Test evidence

As of this report:

- Node unit/static suite: 137 tests, 133 passed, 0 failed, 4 skipped.
- Firestore emulator: 2 tests passed, 0 failed, 0 skipped.
- Auth/Firestore/Functions emulator: the integration test passed; it exercised
  token issue/reuse, projection redaction, role boundaries, RSVP persistence,
  aggregate reconciliation, migration dry-run/apply, regeneration, and revoke.
- Dependency audits: root and Functions dependency trees reported 0
  vulnerabilities after pinning patched `@grpc/grpc-js` 1.13.7.
- Syntax/JSON parsing: passed for the reviewed runtime files/configuration.
- Live Hosting header gate: source-config check passed; deployed-page check
  failed on the missing `frame-ancestors 'none'` policy. Current Hosting headers
  remain a release blocker.
- Live production user flows, same-browser account switching, and deployed
  Firestore rules are not verified.

## Guidance consulted

- [Firebase Firestore field rules](https://firebase.google.com/docs/firestore/security/rules-fields)
- [Firebase callable Functions](https://firebase.google.com/docs/functions/callable?hl=en)
- [Firebase Auth session persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence?hl=en)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [OWASP XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet)
