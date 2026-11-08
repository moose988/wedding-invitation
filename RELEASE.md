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

1. Confirm the target project uses the Blaze plan, has a USD 5 budget alert, and has Firestore initialized. Do not initialize or deploy Firebase Hosting for production.
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

Each live step needs the owner's approval. Complete the temporary AWS proof and tear it down before the shared stack deployment. The owner also confirms Firebase Blaze with a USD 5 budget alert, Vercel Pro, and an AWS paid plan with a budget alert and a Lambda concurrency quota of at least 1,000.

1. Deploy the compatible Firestore rules and indexes first. The frontend needs these rules for its writes.

   ```powershell
   firebase deploy --only firestore:rules,firestore:indexes --project weddinginvitaion-b4f36
   ```

2. Deploy the shared AWS photo bucket stack. Supply both administrator UIDs, all allowed site origins, an SNS topic with the owner's confirmed email subscription, and an existing packaging bucket in `eu-north-1`. Keep the photo and backup buckets in `eu-north-1`.

   ```bash
   export PACKAGE_BUCKET=your-packaging-bucket
   backend/deploy.sh "$ADMIN_UIDS" "$SITE_ORIGINS" eu-north-1 eu-north-1 "$ALARM_TOPIC_ARN"
   ```

3. Set the following environment variables on the Vercel production project.

   - `FIREBASE_SERVICE_ACCOUNT_JSON` contains the service account JSON.
   - `PHOTO_BUCKET_API_URL` is the `ApiUrl` from the shared stack, without a trailing slash.
   - `CRON_SECRET` is a random secret of at least 32 characters. Vercel Cron sends it to `/api/demo-cleanup`.
   - `DEMO_SERVICE_ADMIN_UID` is an enabled platform admin also included in the stack's `ADMIN_UIDS`.
   - `FIREBASE_WEB_API_KEY` is the `apiKey` from the site's Firebase config.

4. In the same commit, switch `API_URL` in `photo-bucket/config.js` and the matching test expectation to the shared stack's `ApiUrl`. Merge the verified changes into `main` to trigger the production Vercel deploy.

5. Run `scripts/post-deploy-check.mjs` against the production URL with a platform admin ID token. Resolve all failures, including `/api/admin-health` checks, before continuing.

6. Provision both admins in a private terminal. The script shows generated passwords once. Run the provisioning command without `--apply` first to inspect the proposed changes.

   ```bash
   node scripts/provision-admins.mjs --project weddinginvitaion-b4f36 --apply --email-shadi "$SHADI_EMAIL" --email-daya "$DAYA_EMAIL"
   ```

   Verify both accounts, then retire the old test admin after transferring its ownership to one of the new admins. Pass both email flags as above and add `--retire-old-admin test@gmail.com --transfer-to "$SHADI_EMAIL"`. This disables the old account after the transfer. Deletion additionally requires `--delete` and a typed confirmation. Update the shared stack's `ADMIN_UIDS` and redeploy it, then recheck admin health.

Before hosting a paid event, have the quotation terms reviewed and trial invitation, RSVP, photo upload, offline resume, gallery, delete and restore on an iPhone and an Android phone.

### After every deploy: configuration and exposure check

When required secrets are Production-only, an ordinary branch preview will return
`503 NOT_CONFIGURED`. Validate a staged production build using the existing
Production configuration instead of broadening secret access to every preview:

```sh
vercel deploy --prod --skip-domain --yes
vercel curl /api/admin-health --deployment https://<staged-deployment> --yes
```

First link the checkout to the intended Vercel project and team. `--skip-domain`
keeps the live aliases unchanged. An unauthenticated `401` confirms the function
loads its configuration; it does not replace the authenticated health check below.
After validation and the authorized merge, promote the verified deployment with
`vercel promote https://<staged-deployment> --yes`, then repeat the checks on the
live custom domain. Record any unavailable checks explicitly in the release report.

1. Sign in to the live dashboard as a platform admin.
2. Open the browser's network tab and copy the `Authorization: Bearer ...` value from any `/api/` request. This is an ID token, valid for about an hour.
3. In a terminal, load the token without echoing it or saving it to shell history, then run the check:

   ```sh
   read -rs QD_ADMIN_ID_TOKEN && export QD_ADMIN_ID_TOKEN
   node scripts/post-deploy-check.mjs https://<production-site>
   unset QD_ADMIN_ID_TOKEN
   ```

The script only sends GET requests, and it sends the token only to `/api/admin-health`. It prints PASS or FAIL for:

- every configuration check from `/api/admin-health`, each with a plain-language fix;
- every function answering as deployed;
- every page route returning 200 with `no-store`;
- server code, `backend/`, `docs/`, `.orchestrate/` and Markdown files not being publicly served;
- the CSP `connect-src` allowing the bucket API host.

Do not announce the release until every line passes. A WARNING line passes but needs attention.

Without the script, an admin can open `/api/admin-health` with the same token. It returns `ok`, each check's status and fix, and which functions each failure affects. It never returns secret values.

## Existing event migration

After the compatible rules are active and the client is deployed:

1. An event owner signs in and opens each existing event dashboard. The client creates a resumable migration record, converts legacy chair/guest assignment mirrors into `seatAssignments`, `seatedPeople`, `seatOccupancy`, and `seatingGuests`, clears the old nested assignment mirrors, and marks `seatingSchemaVersion` 2.
2. The owner chooses **Repair projections**. This rebuilds counts-only `publicSummary` and `publicStats`, invitation projections for active tokens, and minimal seating/check-in projections. Run it again if a repair reports an error.
3. Verify one public invitation and RSVP, an authorized bride/groom account, a read-only family page, and an allowed check-in account before distributing new links.
4. If event deletion is interrupted, the owner can retry. The event is unavailable while `deleting` is true; cleanup removes known subcollections in bounded batches before deleting the parent and workspace index.

Stable browser-generated invitation tokens are retained and reprojected. A value encrypted with the old server-only key cannot be recovered without that key. Guests who have no active browser-generated token need a replacement invitation; do not claim old ciphertext was migrated.

## Post-deploy smoke checks

- `node scripts/post-deploy-check.mjs` passes (see above).
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
