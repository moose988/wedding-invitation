# Release gates and operating procedure

Assessment date: 2026-10-16. **Readiness: NOT READY for production activation.**
This is a local implementation and emulator verification; the production site,
rules, data, secrets, and Auth configuration have not been changed by this work.

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
