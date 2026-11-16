# Admin deletion and customer access report

Work started: 16 November 2026. Report completed: 17 November 2026 (Asia/Dubai).

Branch: `codex/admin-deletion-customer-access`

Base: freshly fetched `origin/main`, commit `1733b56`. The local `main` branch was already checked out in another worktree, so this branch was created directly from the fetched remote tip. No merge or production deployment was performed.

## Changes

### Photo bucket deletion and refresh

The admin API previously included buckets marked `deleting` while the background worker purged their files. That made a deleted bucket reappear after refresh.

Both admin and customer lists now exclude deleting buckets. The backend checks strongly consistent metadata after reading the eventually consistent listing index. The browser adapter also filters deletion records for compatibility with an older backend during rollout. File cleanup remains asynchronous; the UI now explains this without promising an exact cleanup time.

Customer-specific bucket listings also recheck the current owners, preventing a stale owner index from showing a bucket that was just unlinked. Regression tests simulate stale index entries and verify that unrelated buckets remain intact.

### Confirmation and demo accounts

Event and photo bucket deletion now require the exact word `delete`, instead of `DELETE` followed by a generated identifier.

Deleting a generated demo event immediately invokes an admin-only server cleanup that removes the event, nested collections, access records, customer-directory entry, and Firebase Auth account. Demo photo buckets use the same account safeguards after the bucket API accepts deletion.

The server identifies the account from its private creation ledger, never a caller-supplied user ID. It preserves ordinary customer accounts, administrators, converted accounts whose email changed, and accounts still used by other events or photo buckets. The existing protection checks are reused. Both event and bucket deletion are retryable.

If event cleanup is interrupted, the event and ledger become eligible for scheduled cleanup immediately. If account cleanup cannot verify other bucket access, it reports pending cleanup and retains the ledger for retry. Custom-song cleanup failure leaves the demo unavailable and retryable rather than orphaning its files. The existing scheduled cleanup configuration remains daily at 03:00 UTC; pending cleanup is not a promise of a retry within minutes.

The demo API has a 60-second execution allowance. Very large deletions can still exceed that allowance and rely on the existing resumable cleanup path.

### Customer access interface

The redesigned panel keeps the site's Manrope typography and green brand colour, with compact rows and a stacked phone layout. It now provides:

- Current access from the server: Linked, Not linked, and protected owner/specialized roles.
- Separate event and photo bucket searches, All/Linked/Not linked filters, and visible result counts.
- Selection counts and action counts; only applicable selections are sent for each action.
- A maximum of 50 selected targets and a Clear selection control.
- An unlink confirmation naming the customer and every affected target.
- Per-target outcomes; successes are cleared and failed targets stay selected for retry.
- Explicit loading, lookup errors, service-unavailable states, and list retry buttons.
- Protection against stale lookup responses after editing the email, and locked identity controls during mutations.
- Accurate busy feedback, including no permanent spinner when Clear selection becomes disabled.

The customer lookup returns bucket-service failures separately from empty access, so an unavailable service is never presented as proof that the customer has no bucket access. Expired demos cannot be newly linked from the panel.

Entry-page asset versions were updated so the new CSS and event controls are revalidated on rollout.

### Verification fixes found during the work

Two existing Windows failures were corrected: identical concurrent uploads now share one local blob write instead of racing to rename the same content hash, and a source assertion accepts both CRLF and LF line endings. The existing concurrency test verifies persistence after restarting the local backend.

## Verification

All final automated runs used Node **22.23.5** and disposable local Firebase emulators. No production records were deleted during testing.

| Check | Result |
| --- | --- |
| Full Node suite, including backend/concurrency tests | 547 total: **484 passed, 63 skipped, 0 failed** |
| Admin API Auth/Firestore emulator tests | **31 passed, 0 skipped, 0 failed** |
| Firestore security/regression suite, ten test files | **27 passed, 0 skipped, 0 failed** |
| Real Chrome UI checks | **13 checks passed**, no uncaught browser errors |
| Layout measurements at 1440, 768 and 390px | **0 failures, 0 warnings** |
| Design source lint | **0 failures**; two shadow warnings explained below |
| JavaScript syntax and `git diff --check` | Passed |

The 63 skipped cases in the plain Node run require opt-in emulator environments. The admin API and the ten-file security suite were run separately with those environments enabled; this does not claim that every optional suite was executed.

The browser checks exercise invalid email input, protected roles, mixed event/bucket linking, persistence after reload, filters and selection retention, unlink cancellation and confirmation, partial failure and retry, stale lookup rejection, normal event deletion, demo event/account deletion, demo bucket/account deletion, and deletion remaining absent before the file sweep. Backend records and Auth account removal are asserted directly, in addition to visible UI results.

### Reproduction

Use Node 22 with the repository's dependencies installed. Run the normal suite with:

```powershell
node --test --test-reporter=tap --test-concurrency=1
```

Run the configured security and admin API suites separately with `npm run test:security` and `npm run test:admin-api`. The verification here used their test files directly against already running loopback emulators.

For browser checks, start `npm run dev:emulator`, install Playwright in a temporary local prefix, then run:

```powershell
npm install --prefix .local-evidence/browser playwright --no-audit --no-fund
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:ADMIN_ACCESS_PLAYWRIGHT_MODULE = '.local-evidence/browser/node_modules/playwright/index.mjs'
node scripts/check-admin-access-browser.mjs
```

The browser script requires installed Chrome. It creates disposable accounts/events and local buckets; some fixtures remain for inspection. Its before image uses the original panel from base commit `1733b56`. Test diagnostics overlays are hidden only for screenshots.

## Visual review and evidence

This was a component redesign inside an existing product, so the design skill's component exception was used: no new direction draw, seed, font, or palette was introduced. The panel answers: **Which customer has access to which events and photo buckets, and what will this action change?** Access labels beside each event and bucket are the main new visual element.

The final desktop, tablet and phone screenshots were inspected. The hierarchy leads from customer identity to current access and then actions; fields and row edges align; colour conveys linked/protected states; counts derive from the displayed data; empty and unknown access states are distinct; no chart or invented metric is present; phone columns stack with 44px controls and no horizontal overflow. The shorter desktop column keeps its natural height rather than stretching an empty box. Long lists remain scrollable and may require scrolling on phones.

Automated design inspection used a rendered component snapshot to avoid the authenticated page's login redirect. Actual interactions were separately verified on the real authenticated page. Source lint's two shadow warnings concern an unchanged customer-card rule outside the redesigned panel and the panel's explicit `box-shadow: none`; neither produced a rendered inspection warning.

All names and `example.test` emails in the evidence are synthetic emulator fixtures. Production renders actual records. No sample data was added to the application.

- [Before, desktop](admin-access-2026-11-16/before-desktop.png)
- [After, desktop](admin-access-2026-11-16/desktop.png)
- [After, tablet](admin-access-2026-11-16/tablet.png)
- [After, phone](admin-access-2026-11-16/mobile.png)
- [Browser check results](admin-access-2026-11-16/browser-results.json)

## Rollout requirements and limits

The branch contains both the frontend/Vercel API changes and the AWS photo bucket backend change. Both must be deployed for all server-side guarantees, including consistent customer-specific bucket listings. The frontend deletion filter also hides deleting records from older API responses during rollout.

Existing Firebase Admin credentials and the configured photo bucket API are required for immediate demo-account cleanup. Existing scheduled cleanup and bucket purge workers remain the fallback for interrupted or deferred work. No new secret, database migration, or Firestore-rule change is required.

Verification covered local emulators and the real backend handler over the local storage implementation. Live AWS purging and production deployment were not exercised, because this task requests an unmerged branch.
