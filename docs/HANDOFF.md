# Handoff: continuing work on `feature/event-backup`

Written 10 November 2026. Paste everything below the line into Claude Code, opened in a clone of this repository.

This file is public, because the repository is public. It holds no account IDs, passwords, keys or infrastructure addresses, and it does not describe security findings in detail. The owner has a private audit report; ask them for it.

---

You are continuing work on QD Events, a bilingual (Arabic/English) invitation and event platform.

## Repo and branch

- GitHub: `moose988/wedding-invitation`
- Work on the branch `feature/event-backup`. It is ahead of `main` and already pushed.
- `main` is the live site. Do not merge into `main`, push to `main`, or deploy anything without the owner's explicit yes.
- Start with: `git fetch`, `git switch feature/event-backup`, `git pull`, `npm ci`.

## How the system is built

- Static HTML and plain JavaScript on Vercel. No framework, no build step.
- Firebase Auth and Firestore. The browser reads and writes Firestore directly; `firestore.rules` is the gatekeeper.
- Admin server functions in `api/` (Vercel, Firebase Admin SDK).
- Photo buckets on a separate AWS stack in `backend/` (Lambda, DynamoDB, S3).
- Read `README.md`, `SECURITY.md`, `ACCESS-WORKFLOW.md` and `RELEASE.md` before changing anything.

## What is already built on this branch

All of it is for administrators only and has been tested on local emulators only.

1. **Per-event backup and restore.**
   Files: `api/admin-event-backup.js`, `api/_lib/event-backup.js`, `event-backup.js`, `event-backup-ui.js`.
   On All Events: "Download backup" and "Restore from backup" in each event's "⋯" menu, plus "Restore event from backup" next to Create event.
2. **One shared "Access" section**, a collapsible panel in the style of the photo bucket page's "Edit details".
   Files: `access-section.js`, `access-section.css`, `event-access.js`, `event-access-ui.js`.
   Used in three places: the photo bucket manage page, the event dashboard's settings, and under the Access button on All Events cards.
   It talks only to `/api/admin-customer-access` (actions: `event-access`, `accounts`, `search`, `create`, `cancel-invite`, `lookup`, `link`, `unlink`).
3. **"Usage and cost" section** in the same design.
   Files: `usage-section.js`, `event-usage.js`.
   Shown on the event dashboard settings and the photo bucket manage page. All figures are estimates.

## Rules you must keep

- Firebase stays on the free Spark plan. No Cloud Functions, no scheduled Firestore backups, nothing that needs the paid plan.
- Do not change `firestore.rules` unless there is no other way. If you must, stop and ask the owner first.
- Everything new must be admin only, checked on the server with `requireAdmin`, and covered by a test.
- Do not touch the guest-facing pages (`index.html`, `script.js`, `invitations/`, `gender-reveal*`, `checkin*`, `side*`, `send*`) unless a task below says so.
- Keep the invitation link format: `?wedding=<id>#guest=<token>`.
- The Access section must look the same everywhere. Change its look only in `access-section.css`.
- Never use native browser pop-ups (`alert`, `confirm`, `prompt`). Use `action-feedback.js`.
- Every control must be at least 44 px tall at 360 px wide.
- Escape everything that reaches the page as HTML, using `esc()` from `admin-api.js`.
- Write in plain English in the UI. No jargon.
- Never commit passwords, keys or tokens, and do not write security findings into the repository. It is public.
- Work one task at a time. After each one, report briefly what changed and how you checked it, then wait for "next".

## Running it locally

- `npm run dev:emulator` starts the site with local Auth and Firestore emulators. It needs Java and the Firebase CLI on `PATH`.
- In a second terminal, seed demo data:
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed:local`
- Open `http://127.0.0.1:5173/dashboard-login.html?emulator=1`. Use `127.0.0.1`, not `localhost`, or guest photo uploads are refused by the dev server.
- The demo admin and customer accounts and their test password are in `scripts/seed-local-access.mjs`.
- Restart the dev server after changing anything in `api/`. It caches those files.
- Never run `npm run dev` (without `:emulator`) for testing. That uses live data.

## Tests

All of these must pass before you report a task done.

- `npm test`
- `npm run test:security`
- `npm run test:admin-api`
- `npm run test:event-backup`
- `npm run test:access`
- `cd backend && npm test`

The emulator suites cannot run while `npm run dev:emulator` is running, because they use the same ports. Stop it first.

Counts when this was written: 477 unit, 24 security, 27 admin API, 6 backup, 4 access, 82 backend.

## Tasks, in this order

**Task 1. Usability walk-through of the admin pages.**
- Sign in as admin on the emulator. Go through All Events, Customers, Clients, one event dashboard (every view), and one photo bucket manage page.
- Do each at 1280 px, 390 px and 360 px wide.
- Write a numbered list of concrete problems: which page, what you did, what went wrong or was confusing, and how serious it is. Do not fix anything yet.
- Show the list to the owner and let them choose what to fix.
- Then fix the chosen items one at a time, with a test for each.

**Task 2. Photo bucket manage page at phone width.**
- With the Access and Usage sections open at 390 px and 360 px: no sideways scrolling, no clipped text, every control at least 44 px tall.

**Task 3. Check the AWS prices.**
- `event-usage.js` has approximate storage prices (`PRICES`). Ask the owner for the real figures from the AWS bill for the photo bucket region and update them. Update `tests/event-usage.test.mjs` if needed.

**Task 4. Give sender links an expiry.**
- New sender links are created with no expiry (`dashboard.js`, the sender capability code). Give them a default expiry of 7 days and show the expiry date where the link is created.
- The rules already honour an expiry, so no rules change should be needed. Confirm with `npm run test:security`.

**Task 5. Page the gender reveal responses.**
- The dashboard loads every response at once (`dashboard.js`, the `genderRevealResponses` listener). Add paging or a limit to that list. This needs no rules change.
- If you think a limit in `firestore.rules` is also needed, write up the proposal and ask the owner before doing it.

**Task 6. Cache to save Firestore reads.**

The project is on the free plan, with a daily read allowance shared by every event. The aim is to make repeat page opens cost far fewer reads. The trade-off is that a cached page can show data that is a few minutes old, so agree the acceptable delay with the owner for each page before changing it.

- Measure first. On the emulator, count the reads for one open of: a guest invitation, the event dashboard, the check-in page, and All Events as admin. Write the numbers down. Repeat after each change so the saving is a measured figure, not a guess. The Usage and cost section's estimates (`event-usage.js`) are a starting point, not a measurement.
- Guest invitation (`invitations/shared/invitation-live.js`). This is the page opened most often, and this task is the one exception to the "do not touch guest pages" rule. It keeps live listeners on the hall layout, the venue objects and the schedule, which rarely change. Options to propose to the owner:
  - Read those three once per open instead of listening, and keep the result in the browser for a short time (for example 10 minutes), so a guest who reopens the link reads nothing new for them.
  - Keep the live listener only on the guest's own invitation document, so an RSVP or a seat change still shows straight away.
  - Do not change what the page shows or the link format. Get the owner's yes before editing this file, and try it on a real phone on a slow connection.
- Event dashboard (`dashboard.js`). It listens to every guest, table, seat assignment, seat marker and invitation secret. Look at turning on Firestore's local cache (`persistentLocalCache` in `firebase-config.js`), so reopening the dashboard soon after reads only what changed. Check it against the existing "one named app per tab, session persistence" design in `SECURITY.md`: cached guest data stays on the device, so it must be cleared on sign-out and must never be shared between accounts on one browser.
- Admin All Events (`admin-events.js`). The event list is already kept for 60 seconds. Consider keeping it for the tab's lifetime with a Refresh button, since it reads every event.
- Do not cache anything that decides access (memberships, admin records, invitation tokens). Those must always be read fresh.
- Do not solve this by merging documents or changing `firestore.rules`. If you believe that is needed, write up the proposal and ask the owner.
- Add tests for each change, and state in your report how stale each page can now be.

**Task 7. Trial on a Vercel preview, only with the owner's yes.**
- Open the Vercel preview for the branch and run `scripts/post-deploy-check.mjs` against it.
- Previews have no server secrets configured, so the admin functions answer "not configured" there. Tell the owner; they decide whether to add preview secrets.
- Try backup and restore on one demo event only. Restore makes an event unavailable while it runs, so never try it on a real event.

**Task 8. Hand back to the owner.**
- Summarise what changed, what was tested and how, and what is still not verified.
- The owner decides whether to merge into `main`. No Firestore rules deploy is needed for the work already on this branch, because the rules did not change.

## Open decisions that belong to the owner

Ask the owner for the private audit report before working on any of these. Do not try to fix them without asking.

- The Firebase plan and its daily allowance.
- How the main database is backed up.
- How administrators sign in.
- Whether the GitHub repository stays public.

## When you are unsure

Stop and ask the owner. Do not guess on anything that touches live data, security rules, or what customers and guests see.
