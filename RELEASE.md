# Release and migration procedure

## Current local status

The frontend is deployed through the existing Vercel project `wedding-invitation-nlsf`, connected to `moose988/wedding-invitation` on `main`. Firebase provides Authentication and Firestore; Firebase Hosting is not part of production deployment. Cloud Functions are not deployed by this application.

## Pre-deploy checks

Use Node.js 22+, Java 21+, and the Firebase CLI. From Windows PowerShell at the repository root:

```powershell
npm ci
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
npm test
npm run test:security
```

`npm run test:security` runs the Firestore emulator only. Do not use real guest data in emulator fixtures.

## Firebase Console requirements

1. Confirm the target project uses the Spark plan and Firestore is initialized. Do not initialize or deploy Firebase Hosting for production.
2. Enable Email/Password under Authentication → Sign-in method.
   Gender Reveal invitations also require Anonymous Authentication; their named
   Auth instance must remain separate from planner/customer sessions.
3. Confirm each existing authorized account has the correct UID-keyed event membership and permissions. The email address is not an authorization key.
4. Review `firebase.json`'s Hosting site name and CLI project selection before deploying.

CLI setup:

```powershell
firebase login
firebase use weddinginvitaion-b4f36
```

## Deployment order

Deploy compatible Firestore rules and index configuration first:

```powershell
firebase deploy --only firestore:rules,firestore:indexes --project weddinginvitaion-b4f36
```

Then commit and push the tested frontend changes to `main`. The connected Vercel project creates the production deployment automatically. Do not run `firebase deploy --only hosting`, enable billing, or deploy Functions.

## Existing event migration

After the compatible rules are active and the client is deployed:

1. An event owner signs in and opens each existing event dashboard. The client creates a resumable migration record, converts legacy chair/guest assignment mirrors into `seatAssignments`, `seatedPeople`, `seatOccupancy`, and `seatingGuests`, clears the old nested assignment mirrors, and marks `seatingSchemaVersion` 2.
2. The owner chooses **Repair projections**. This rebuilds counts-only `publicSummary` and `publicStats`, invitation projections for active tokens, and minimal seating/check-in projections. Run it again if a repair reports an error.
3. Verify one public invitation and RSVP, an authorized bride/groom account, a read-only family page, and an allowed check-in account before distributing new links.
4. If event deletion is interrupted, the owner can retry. The event is unavailable while `deleting` is true; cleanup removes known subcollections in bounded batches before deleting the parent and workspace index.

Stable browser-generated invitation tokens are retained and reprojected. A value encrypted with the old server-only key cannot be recovered without that key. Guests who have no active browser-generated token need a replacement invitation; do not claim old ciphertext was migrated.

## Post-deploy smoke checks

- Owner and authorized account sign in, refresh, and sign out independently in two browser tabs.
- Bride/groom links route through account sign-in and show only the membership-authorized side.
- Assign, move, swap, and unassign seats; try the same empty chair from two side accounts at once.
- Copy one invitation twice, load it in a private window, submit an allowed RSVP, then revoke and confirm it no longer loads.
- Open a sender link, confirm only selected recipients appear, then revoke it.
- Scan an invitation token while signed in as a permitted check-in account; confirm an invitation bearer alone cannot check people in.
- Confirm browser network activity for these routes has no `cloudfunctions.net` or Cloud Run requests.

Record which smoke checks were completed. Emulator results do not prove the deployed Firebase Console configuration or production browser behavior.

## Gender Reveal submissions

Run `npm run test:gender-reveal` with the real Auth and Firestore emulators in
addition to the existing unit and security suites. This covers first creation,
independent sessions, duplicates, concurrent commits, transport fault recovery,
private reads, incomplete bundles, and live authorized response listeners.

For desktop and mobile Chrome invitation checks, install Playwright and
its browsers, set disposable `GENDER_REVEAL_TEST_PASSWORD` and
`GENDER_REVEAL_BROWSER_RUN_ID` values, then run:

```powershell
firebase emulators:exec --only auth,firestore --project demo-wedding-security "node scripts/check-gender-reveal-browser.mjs"
```

`GENDER_REVEAL_PLAYWRIGHT_MODULE` may point to an installed Playwright
`index.mjs`. Set `GENDER_REVEAL_BROWSER_ENGINE=webkit` to run the optional
WebKit mobile check. The script only seeds the loopback demo project. Mobile
emulation uses Chrome as the dashboard observer because Windows WebKit stalls
on the emulator dashboard transport; it is not a physical iPhone test.

Deploy the matching Firestore rules before pushing the frontend to `main`.
Verify the active ruleset and live asset hashes: a Vercel deployment does not
update Firebase rules. Both the preceding session-key client and this client
write the same four-document bundle, so the rules-first rollout is compatible.

If an audited event has counters inconsistent with canonical saved responses,
`scripts/repair-gender-reveal-totals.mjs --event=<event-id>` previews an IAM repair
and writes a local backup. Add `--apply` only for an authorized repair. It uses a
serializable transaction, preserves responses/event status and other fields,
and makes no changes when the counters already match. Set `FIREBASE_CLI_LIB` to
the installed Firebase CLI `lib` directory; never put IAM credentials in client
code or evidence reports.
