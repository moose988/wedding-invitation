# Release gates and operating procedure

Assessment date: 2026-10-16. **Readiness: NOT READY for production activation.**
This is a local implementation and emulator verification; the production site,
rules, data, secrets, and Auth configuration have not been changed by this work.

## Spark-only recovery follow-up (2026-10-17)

The live Firebase Console was inspected read-only. The project is on the Spark
plan and `firebase functions:list --project weddinginvitaion-b4f36` reports no
deployed Functions. No Firestore data or rules were changed.

The signed-in `test@gmail.com` account has three existing root event documents:
`ali & salma` (owner), `mohmads birthday` (owner), and the active `Layla & Zaid`
demo event (admin membership). All three have matching entries in that user's
`users/{uid}/weddingAccess` index and the canonical event documents exist. A
fourth index entry labelled `taiba & mohamad (Copy)` points to a missing event
document; the index is metadata only and cannot reconstruct the event, its
guests, or seating. Firestore backup/import-export tools are unavailable on
Spark, so that missing event was not recreated or guessed at.

The other supplied account was checked by UID, not inferred from its email. It
has no membership document on either owner event. On the shared Layla & Zaid
demo it has a seating-only membership with `allowedSide: all`, no check-in or
export permission, and no user-specific access to the two owner events.

The All Events client now discovers candidates from the signed-in user's
private `weddingAccess` collection, then reads each canonical event document so
the deployed Firestore rules decide whether that account can see it. The index
alone is never trusted; the flow does not query the global events collection.
It also distinguishes a load error from a successful empty result and exposes
a retry button. This change is local and has not been deployed.

The broader Spark-only conversion remains a release blocker. Client call sites
still depend on undeployed Functions: `getGuestInvitation`,
`submitGuestInvitationRsvp`, `getGuestInvitationTokens`,
`manageGuestInvitationAccess`, `exchangeSeatingEditorLink`,
`manageSeatingEditorAccess`, `getSideSeatingState`, `mutateSideSeating`,
`resolveCheckinGuest`, `getCheckinGuestList`, `createSenderSession`,
`getSenderSession`, and `deleteWedding`. Event creation, editing, and archive
are direct Firestore operations; hard deletion is not. Each listed operation
needs a rules-enforced Firestore design or a server backend. For example,
custom Firebase Auth token exchange requires trusted signing and cannot be
replaced by a browser secret; public invitation reads/RSVP need a capability
document and strict rules, while check-in must stay account-authorized. Those
replacements and direct REST/SDK negative tests have not been implemented.

The full Node suite passes (133 passed, 0 failed, 4 gated skips). The Firestore
emulator suite is blocked because the machine has Java 19 while the installed
Firebase CLI requires Java 21+. No paid plan or service was enabled. Full
no-backend conversion, live-rule compatibility tests, migration backup,
authenticated browser regression, and deployment have not been completed; do
not treat this follow-up as a production release.

## What is local, staged, and deployed

| Environment | State |
| --- | --- |
| Local repository | Security changes, Functions, Firestore rules/indexes, headers, migration scripts, and tests are present. Unit and emulator suites pass as listed below. |
| Staging | No isolated Firebase staging project/site was available or deployed. Tests used local emulators with synthetic fixtures. |
| Production Firebase project `weddinginvitaion-b4f36` | No code, rules, indexes, secrets, or customer documents were deployed or changed by this work. `firebase functions:list` reports no deployed Functions. |
| Current Hosting site `weddinginvitaion-b4f36.web.app` | Read-only HEAD requests to `/index.html`, `/dashboard.html`, and `/side.html` returned 200. CSP, Referrer-Policy, and X-Frame-Options were absent. HTML returned `must-revalidate, no-cache, max-age=0`; it did not have `no-store`. HSTS was present from Hosting. The local `firebase.json` header policy is not live. |
| Deployed Firestore rules / Auth settings / Storage rules | Not verified. The repository contains the proposed local rules; the current CLI session does not provide Application Default Credentials for the data migration audit, and the connected project has no Functions deployment. |

The Hosting Emulator response used during the header check also lacked custom
headers. The source-config test passes, but the emulator result is not evidence
that Firebase Hosting will serve the proposed headers. The release gate must be
run against an isolated deployed test site and again against production after
the approved release.

## Test matrix

| Area | Result | Evidence / limitation |
| --- | --- | --- |
| Node unit and static contract tests | **Passed** | `node --test --test-reporter=tap tests/*.test.mjs` — 137 tests, 133 passed, 0 failed, 4 gated skips. Emulator checks were run separately; hosted checks need a configured test URL. |
| Firestore rules: anonymous, cross-event, side access, check-in fields, protected fields | **Passed** | Firestore Emulator — 2 tests passed, 0 failed, 0 skipped. The suite checks additions and deletions of protected fields and persisted documents. |
| Functions: invitation issue/reuse, minimal projection, RSVP allowance, sender capability expiry/revocation, persisted counts, side seating, check-in role, token migration, no-store responses | **Passed locally** | Auth/Firestore/Functions Emulator integration test passed with synthetic accounts/events. It applies the migration to one synthetic predictable demo token, verifies the legacy mirror and field are removed, checks anonymous sender-capability resolution and expiry/revocation, and verifies raw callable `Cache-Control: no-store` headers. |
| Dependency audits | **Passed** | `npm audit` and `npm audit --prefix functions` — 0 vulnerabilities after an override to patched `@grpc/grpc-js` 1.13.7. |
| Syntax and JSON parse | **Passed** | `node --check` passed for `functions/index.js`, `send.js`, `dashboard.js`, and `checkin.js`; JSON parsing passed for both package manifests, `firebase.json`, and `firestore.indexes.json`. |
| Live Hosting header test | **Failed against current deployment** | PowerShell: `$env:HOSTING_SECURITY_TEST_URL='https://weddinginvitaion-b4f36.web.app'; node --test --test-reporter=spec tests/hosting-headers.test.mjs` — source-config check passed; deployed-page check failed because `frame-ancestors 'none'` was absent on the first private page checked. HEAD checks for `/index.html`, `/dashboard.html`, and `/side.html` also found CSP, Referrer-Policy, and X-Frame-Options absent and no `no-store` on HTML. |
| Dashboard/customer same-browser and separate-browser session matrix | **Blocked** | Supplied test account passwords are not available in the private session context. No account role was inferred from email. |
| Full UI/browser regression across desktop/mobile, templates, maps, calendars, seating gestures, exports, check-in scan/search, and sending | **Blocked / partial static coverage** | No authenticated browser E2E was run. Existing Node tests cover source contracts, security logic, utilities, and synthetic emulator behavior; they do not verify every UI interaction. |
| Real sending/reminders | **Not run** | No real invitation or reminder was sent. Use a provider sandbox or synthetic recipient before production. |
| Membership migration dry-run | **Blocked before data read** | Running `node functions/migrate-dashboard-memberships.js --project weddinginvitaion-b4f36` failed because Google Application Default Credentials are unavailable. No records were read or changed. |
| Invitation-token migration against production | **Not run** | The owner-only callable passed against a synthetic emulator event. No authorized owner browser session was available for a real event dry-run. |

## Launch blockers

1. Run the dashboard-membership migration dry-run with authorized, read-only
   project credentials. Review conflicts and event counts. Back up before
   applying the additive `userId` migration.
2. Run `migrateInvitationAccess` in dry-run mode for each real event using an
   authenticated event owner. The repository currently has no owner-facing
   migration panel; provide an approved owner-authenticated release harness.
   Stop on any unsupported guest fields and define a preservation mapping.
3. Decide how to handle old invitations. Applying the migration deletes legacy
   token fields and mirrors. Old shared invitation links then stop working;
   organizers must share the newly issued links. There is no insecure legacy
   acceptance path. Old base64url WhatsApp sender bundles are also rejected
   outside explicit demo mode; create new 24-hour sender links after Hosting
   cutover. No production inventory or recipient resend has been done.
4. Move full-dashboard table mutations that require global layout consistency
   behind server validation, or otherwise enforce/test capacity, duplicate
   assignments, and table/guest consistency. Current direct full-layout writes
   are a release blocker for the requested integrity guarantees.
5. Perform the mandatory authenticated browser session matrix with synthetic
   test events and the two supplied accounts after verifying their actual
   roles. In particular, check session isolation, tab refresh, logout, stale
   data clearing, and revocation while open.
6. Verify production Auth settings and deployed rules, and test App Check in an
   isolated project. Configure the two server secrets in Secret Manager. Do not
   treat App Check as a replacement for authorization.
7. Deploy the source Hosting headers and pass `tests/hosting-headers.test.mjs`
   against an isolated test site before production.

## Migration inventory and cutover

### Dashboard membership field

`getAccessibleWorkspaceEvents` queries `dashboardUsers.userId`; older
membership documents may not have that field. The script is dry-run by default
and prints counts only. First provision ADC with a least-privilege read-only
role and run:

```powershell
node .\functions\migrate-dashboard-memberships.js --project weddinginvitaion-b4f36
```

Review `events`, `memberships`, `needsUserId`, `conflicts`, `nextCursor`, and
`done`. If `done` is false, resume with the returned cursor. Resolve any
conflict before applying. Export a protected Firestore backup, then rerun with
`--apply` and the same cursor/pageing plan. The migration writes
`userId == dashboardUsers document ID` and a server timestamp; it does not
change permission fields. Verify the final counts before deploying the backend
query that requires this field.

### Guest invitation cutover

The owner-only callable accepts:

```text
migrateInvitationAccess({
  weddingId,
  mode: "dry-run" | "apply",
  pageSize: 1..200,
  cursor: ""
})
```

`apply` additionally requires the exact confirmation string
`ROTATE INVITATIONS {weddingId}`. The dry-run reports counts for predictable
demo tokens, other legacy values, mirrors, and unsupported fields; it does not
return raw token values. Record only counts in the release log. The operation
is page-based and resumable; save each returned cursor, verify completion, and
do not start a second operator against the same event concurrently. After the
final page, legacy mirrors are removed and public aggregates are rebuilt.

Before apply:

- Confirm event owner and event ID from Firebase data; never treat a readable
  event ID as authorization.
- Create and test a restricted backup. A backup containing old invitation
  tokens remains sensitive even after revocation.
- Share a cutover date with the event owner and arrange a controlled resend
  using test recipients first.
- Preserve any unsupported guest fields through an explicit mapping. Do not
  delete fields merely to make the migration pass.

After apply, verify migrated guest count, absence of legacy fields/mirrors,
new token issue and lookup, RSVP state, and owner copy behavior. Old links
cannot be restored confidentially by rolling back data; a leaked old bearer
link has already been disclosed. Issue new credentials instead of reviving old
ones.

## Deployment order

Use a separate Firebase staging project with synthetic fixtures first. The
production project currently has no isolated staging configuration, so do not
use a Hosting preview channel connected to the production Firebase config as a
substitute.

1. Review backups and migration dry-runs. Verify the exact Firebase project ID
   and Hosting site. Confirm billing, IAM, and supported Node runtime.
2. Apply the additive membership `userId` migration only after dry-run review
   and backup. Wait for the new collection-group index to become ready.
3. Configure distinct, high-entropy
   `INVITATION_TOKEN_ENCRYPTION_KEY` and `SEATING_LINK_ENCRYPTION_KEY` values in
   Firebase Secret Manager. Never print or commit them.
4. Deploy indexes, then Functions:

   ```powershell
   firebase deploy --only firestore:indexes --project weddinginvitaion-b4f36
   firebase deploy --only functions --project weddinginvitaion-b4f36
   ```

   Confirm the callable functions are healthy with synthetic/staging accounts
   before proceeding.
5. Deploy Hosting so new pages call the new Functions. Existing open tabs may
   need a refresh when the tightened rules are released.
6. Deploy Firestore rules last in the same controlled release:

   ```powershell
   firebase deploy --only firestore:rules --project weddinginvitaion-b4f36
   ```

   No step widens Firestore rules as a compatibility bridge. If deployment
   stops early, do not deploy rules. After rules go live, immediately run the
   live negative-access and Hosting-header release gates.
7. Migrate invitations event by event, starting with a synthetic/staging event.
   Reconcile counts before the next event. No mass resend is part of this
   release procedure.
8. Run the post-deployment smoke list below and observe Functions errors,
   access-denied rates, and guest RSVP reconciliation before expanding use.

## Backup and rollback boundaries

- Before data migration, use Cloud Firestore managed export to a restricted
  bucket with access logging and retention controls. Verify that the export
  completed, and test a restore into a separate staging database before relying
  on it. Export/import incurs reads and writes; budget the operation.
- Preserve the exact release commit, `firebase.json`, rules, index definitions,
  function source, Hosting release/version identifier, and secret version
  references. Do not export secret values into the release bundle.
- For a bad Hosting release, use Firebase Hosting release history to restore a
  previously tested compatible version. Do not roll back to a page that
  requires the permissive old rules.
- For Functions/rules, redeploy a reviewed compatible source revision. Keep
  deny-by-default rules in place during rollback; if the client has a defect,
  repair/roll forward the client rather than reopening public Firestore reads.
- The additive membership field can remain during rollback. Do not remove it
  while a deployed backend query depends on it.
- A pre-migration data restore may reintroduce old raw tokens and mirrors.
  Restore only into an isolated environment unless a privacy review explicitly
  authorizes otherwise. Restoring an exposed bearer value cannot undo exposure.

## Post-deployment smoke test

Use synthetic events and recipients first. Inspect persisted state, not only
client toasts.

- Verify all Functions deployed and both encryption secrets are available to
  the functions that need them.
- Confirm anonymous direct SDK/REST reads of event, guest, table, mirror, stats,
  and token collections fail; public aggregate summary succeeds only as
  intended.
- Verify owner create/copy/reveal/revoke/regenerate for one synthetic guest;
  malformed, wrong-event, expired, and revoked tokens return generic
  unavailable errors.
- Verify RSVP with values at and above the guest allowance; inspect guest and
  aggregate documents after each call.
- Verify the seating-only test account cannot access the other side, event
  settings, exports, check-in, or dashboard membership; verify allowed seating
  operations and reload state.
- Verify QR check-in requires an authenticated check-in role, and check-in
  writes cannot change RSVP, roles, or seating.
- Verify browser refresh and two-account session isolation, including logout
  in one tab and revoked access in an already-open tab.
- Verify local QR generation, formula-safe CSV/XLSX output, maps/calendar
  links, template and language routes, demo isolation, and the approved message
  sandbox. Do not send real customer messages as part of this smoke test.
- Create a new WhatsApp sender capability for selected synthetic recipients;
  verify only those contacts appear, the link expires after 24 hours, creator
  permission loss stops refresh, and organizer revocation stops refresh.
- Run the deployed Hosting header test for invitation, dashboard, side, and
  template pages. Confirm the active Hosting release and rules version.

## Current evidence links

- [Firebase Hosting response headers](https://firebase.google.com/docs/hosting/full-config?hl=en)
- [Firebase Hosting release rollback](https://firebase.google.com/docs/hosting/manage-hosting-resources?hl=en)
- [Firestore export/import](https://firebase.google.com/docs/firestore/manage-data/export-import)
- [Firebase Auth persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence?hl=en)
- [Firebase Web SDK setup](https://firebase.google.com/docs/web/setup)

## Browser-issued invitation capability follow-up (2026-10-17)

This section supersedes the earlier callable-based invitation issuance and
deployment steps above for the current working tree. It describes **local
source only**; no Hosting release or Firestore rules were deployed.

The browser generates a 32-byte token using Web Crypto, encodes it as
canonical base64url, and creates the private per-event secret/index documents
and the minimal `publicGuests/{token}` projection in one Firestore transaction.
The secret document keeps the raw token so authorized event guest managers can
copy the same link again. Security Rules allow managers to read that private
record, allow anonymous exact gets of active invitation projections, deny
public listing, and restrict public updates to RSVP fields and the allowance on
that invitation. Revoke deletes the public projection and marks the token
inactive; regenerate rotates the token transactionally. New links are stable
when copied repeatedly; they change only on explicit regeneration.

The projected invitation contains only event presentation data and the one
guest's name, additional-guest allowance, and seating assignment. QR images
remain generated in the browser. RSVP changes are mirrored to the canonical
guest document by an authorized dashboard listener; this is eventual
reconciliation, not an atomic multi-document public transaction. Verify the
canonical guest and counts after RSVP before release.

### Migration and cutover boundary

No production token inventory was read and no migration was run. Earlier
callable-issued raw invitation tokens are not compatible with the new nested
per-event records. The previous server-side encrypted token material cannot be
converted in the browser without exposing its encryption key, and the
production project is on Spark with no deployed Functions. Therefore there is
no safe automatic preservation or in-place conversion path in this release.
Do not run the old callable migration procedure above: those callables are not
deployed on the connected project. Do not apply the new rules while expecting
old public guest documents or callable-based RSVP to keep working. Existing
shared legacy links remain untouched until a separately approved cutover, but
the browser token code does not provide an insecure legacy bypass.

Before any live cutover, the event owner must review a read-only inventory of
each event's existing invitation state, identify legacy/demo links, verify
recipients and event ownership, then choose a controlled rotation and resend
window. The current codebase has no production dry-run tool for reading those
legacy token records. Build and review that tool against a staging export first;
record counts and classifications only, never raw credentials. Back up the
source data before any rotation. Restoring a backup can restore old bearer
tokens, so rollback cannot restore confidentiality after a link was exposed.

### Current verification and deployment order

- `npm test`: **136 passed, 0 failed, 4 skipped** (140 total). These are local
  unit/static-contract tests, not browser or Firestore emulator proof.
- `npm run test:security`: **blocked** because the installed Firebase CLI
  requires Java 21 and this machine has an older Java runtime.
- Local HTTP smoke checks returned 200 for `/dashboard-login.html`,
  `/all-events.html`, `/index.html`, and the Ali & Salma invitation template
  at `http://127.0.0.1:8000`.
- No signed-in multi-account browser test, Firestore emulator run, migration
  dry-run, live send, production change, or rollback drill was performed in
  this follow-up.

For a future staging activation, first use an isolated Spark staging Firebase
project and synthetic events. Back up/export any staging fixtures. Deploy the
deny-by-default Firestore rules and verify direct SDK/REST negative cases,
then publish the matching client build; until both are in place, invitation
copy/RSVP may fail closed. Do not use a temporary public-read rule as a bridge.
Run the full RSVP/revocation and session matrix against persisted emulator or
staging data, then perform the legacy-token inventory and owner-approved
cutover. Production activation remains blocked until Firestore emulator tests,
authenticated browser tests, and the token migration plan have passed review.

## Invitation lifetime correction (2026-10-17)

Guest invitation links are non-expiring. New private token/index records and
public projections store `expiresAt: null`; Firestore Rules no longer use the
event date, event status, or `expiresAt` to authorize an active invitation.
Completion and archival therefore do not invalidate the URL while the event
document and active guest token records remain. Deleting the guest invitation
revokes/removes its capability records; deleting the event makes its child
capability unreadable because the required parent event no longer exists.
Only an authorized organizer's explicit revoke or regenerate action replaces
the active link. Copy/refresh reuses the stored token; logout and deployments
do not rotate it.

The emulator security fixture now seeds a token whose old `expiresAt` is in
2020 and changes its event to `completed` before attempting an anonymous read
and RSVP. This covers legacy dated records and completion status, though the
fixture could not be executed on this machine because Firebase CLI requires
Java 21 (installed runtime: Java 19). Local Node unit/source-contract checks
pass; emulator execution and authenticated refresh/logout browser testing
remain unverified.

## Persistent browser invitation flow — current local verification (2026-10-17)

This section supersedes earlier invitation-flow implementation and test-status statements above. The matching client is live on Vercel production `wedding-invitation-nlsf` (latest application fix commit `dccebd3`). Firestore Rules for project `weddinginvitaion-b4f36` were deployed previously and are compatible. A single clearly labeled synthetic event/guest was created for the live smoke test, then its event tree and user event-access index were deleted after verification; no existing customer event or guest was changed.

- The dashboard creates one 32-byte Web Crypto base64url token per guest and stores its recoverable value only in the private `weddings/{eventId}/invitationSecrets/{guestId}` record, readable by event guest managers. Repeated copy/export/open operations reuse the ready scoped cache; refresh/logout recovers the same token from Firestore. Concurrent creation in separate service instances is serialized by a Firestore transaction.
- Active token indexes bind one token to one event/guest/purpose. Anonymous access is an exact document get of the minimum `publicGuests/{token}` projection; listing and private guest/secret/index reads remain denied. Invitation reads do not use the legacy `getGuestInvitation` callable or 20-second polling. RSVP updates the public invitation and canonical guest in one Rules-validated batch, with status, field, message-size, and per-invitation allowance checks. The organizer dashboard reads that canonical guest state directly; there is no reconciliation write loop.
- Event completion and old stored expiry timestamps do not invalidate an active link. Copy refuses revoked/incomplete capability records. Only an authorized explicit revoke/regenerate changes the invitation capability; regenerating invalidates the previous token. Event or guest deletion removes access through the parent/index checks and authorized cleanup path.
- `npm test`: **138 passed, 0 failed, 4 skipped** (142 total). The skips are emulator-gated cases.
- `npm run test:security`: **2 passed, 0 failed** under the local Firestore Emulator using synthetic fixtures (JDK 21). Coverage includes concurrent ensure, repeated ensure, legacy 2020 expiry with a completed event, revoke/ensure refusal, explicit idempotent regeneration, old-token denial, anonymous roster/private reads and list denial, atomic RSVP and persisted mirror state, plus the existing event, side, seating, check-in, and protected-field cases. Expected permission-denied messages are generated by negative tests.
- `npm audit --audit-level=high`: **0 vulnerabilities**. Java 21.0.12.1 was downloaded from Eclipse Adoptium, SHA-256 verified, and extracted under the current user's Local Programs folder; it was not added to the repository or made a system-wide Java setting.
- The local server at `http://127.0.0.1:8000` serves the repository root. `/dashboard.html` and its versioned `dashboard.js` both returned 200; the served script SHA-256 matched the source file, and the HTML references `dashboard.js?v=20261017-persistent-invitation-3`. The local login page rendered. A synthetic Layla & Zaid sample invitation opened and its in-page sample RSVP reached the confirmed state with the UI explicitly stating that no response is sent. A malformed token rendered the generic “Invitation unavailable” state. A separate browser probe confirmed QR generation stays local using a synthetic input.
- Browser testing exposed a trailing literal `\\n` in `qr.js`, which caused a module parse error and prevented invitation interactivity. It was removed, and the QR import and invitation entry points were cache-versioned. The synthetic invitation-open/RSVP flow and local QR render passed after the fix.
- The deployed dashboard initially served an older bundle that called `getGuestInvitationTokens` and failed at CORS preflight. After commit `cd7db33`, Vercel served `dashboard.js?v=20261017-persistent-invitation-4-side-scoped-tokens`; after commit `dccebd3`, Vercel served `script.js?v=20261017-invitation-no-video-open-1`. The deployed dashboard no longer references the removed callable. The dashboard, token, RSVP data, and invitation modules returned HTTP 200 and matched local source after normalizing line endings.
- A live production smoke test used only the synthetic event `Codex Security Smoke 20261017` and guest `Codex Smoke Test Guest 20261017`: copy produced a 43-character random token link; the deployed invitation opened and showed the guest; RSVP submission succeeded; the dashboard was refreshed and showed the persisted `Confirmed` status; then the event tree and its user access index were deleted. No message was sent. Two-account cross-context, logout, and separate-device tests remain unverified.

The invitation callables `getGuestInvitationTokens`, `manageGuestInvitationAccess`, `getGuestInvitation`, and `submitGuestInvitationRsvp` are no longer referenced by the live dashboard or invitation page. Other callables remain and are outside this change: `exchangeSeatingEditorLink`, `manageSeatingEditorAccess`, `createSenderSession` / `getSenderSession`, `resolveCheckinGuest`, and `getCheckinGuestList` (plus the separately configured owner-only `deleteWedding`). This application is not Function-free; sender sessions, seating-link authentication, and check-in still depend on backend Functions.

### Migration, activation, and rollback boundary

No production token inventory or dry run was performed. Older server-encrypted token records cannot be decoded in a browser without exposing the server key; predictable demo/legacy links are not accepted by the new 43-character live token reader. The client and Rules have been deployed, but existing shared legacy links may be incompatible. First run a read-only owner-authorized inventory, classify legacy/demo records without logging tokens, back up data, and agree a cutover window; then issue new links and resend only through a test/sandbox recipient workflow. Keeping a predictable old link working would keep its guessing risk.

The client is deployed, but no production token inventory or migration dry run was performed. Do not copy links for real guests or resend them until the owner-authorized legacy inventory and cutover plan is complete. The disposable production smoke event verified token copy/open/RSVP behavior but does not replace a full migration dry run or broader release validation. Keep old server-issued links unchanged until their cutover is planned; do not add a permissive legacy bypass. If rollback is needed, revert the client and Rules as a coordinated pair; restoring old bearer tokens from a backup cannot undo confidentiality exposure after sharing.

**Readiness remains NOT READY for general production use.** The Vercel client deployment is confirmed, and local unit/emulator checks pass. No existing customer guest was used in the smoke test. Legacy invitation migration, staging cutover, authenticated multi-account browser regression, and rollback drills remain open.
