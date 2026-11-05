# Release status

Last updated: 6 November 2026. Branch: `fixes/suggested-fixes`.

This file is public, because the repository is public. It holds no account IDs, emails, keys or infrastructure addresses; those stay in the private local notes.

## Is it production ready?

**No, not yet.** The code fixes are well advanced and every automated test passes, but the full walkthrough, the remaining persona checks, an independent review and the go-live steps are still to do. See "Still to do" below.

## Done in this round (Finish prompt steps)

| Step | Result | Commits |
|---|---|---|
| Public status report removed from the repository | Done. The old copy is still in Git history, so making the repository private is recommended. | `fd043a7` |
| 1. Security test fix | Done by the earlier session; re-verified here: 23 of 23 passing twice | `45c0dd3` |
| 2. Song conversion on phones | Done by the earlier session: limited devices are blocked | `160ab51` |
| 3. Local secret file | `.env*.local` is ignored by Git; deleting the file on the other computer is the owner's call | `798581a` |
| 4. Moonlit design and poster PDFs | Reviewed and fixed. The opening picture loads before the garden picture, two small links became 44 px, and the PDF now says when it has downloaded. Checked in the browser at 1280, 390 and 360 px in English and Arabic, and the RSVP saved. The PDF is one A5 page in about 4 seconds. | `1750667` |
| 5a. Dialogs, buttons, tap sizes | No native browser pop-ups remain, and a test guards it. The guest and dance floor forms show busy, then a result. Every control on the customer, dashboard, photo bucket, invitation and admin pages is at least 44 × 44 px at 360 px (checked with `scripts/tap-target-audit.js`). | `0d4fc94` |
| 5b. Seating, headings, Arabic, access page | Seat shortage warning. Builder-only fields hidden from customers. Every dashboard view has its own title, one h1 and correct heading levels. Guest and table names use `dir="auto"`. A non-admin who opens an event they are not linked to now sees "My events" (it used to show the admin page). | `ddc50e5` |

Test results on the latest commit: main suite 439 passing, backend 79, security 23, admin functions 27. No failures.

## Still to do

1. **Step 6:** the full 10-step walkthrough (admin, customer and guest) at 1280, 390 and 360 px. In progress: steps 1 to 6 pass. Bugs found and fixed: a photo bucket could not be created with uploader names switched off; uploads used up their retries when venue Wi-Fi was connected but had no internet (they now wait up to about 30 minutes and resume by themselves).
2. **Step 7:** fill the gaps left in the persona audits: slow and offline networks, the guest security attempts, keyboard-only use, and an accessibility scan.
3. **Step 8:** dependency audit and Node version alignment.
4. **Step 9:** a fresh independent review, repeated until a round has no Critical, High or Medium findings.
5. **Step 10:** every test suite, twice, all passing.
6. **Step 11:** retire the old test admin account. Needs the owner's choice of who takes over its events.
7. **Step 12:** push the final branch, with the owner's yes.
8. **Step 13:** go live, one step at a time with the owner's yes:
   - Firestore rules first, including the Moonlit change;
   - a Vercel preview, checked with `scripts/post-deploy-check.mjs`;
   - then `main`.
9. **Owner items:**
   - confirm the AWS alert email;
   - consider Vercel Pro, because Hobby does not allow commercial use;
   - have the quotation terms reviewed;
   - do one real-phone trial.

## Known notes

- The Moonlit invitation downloads about 1.4 MB on first open, mostly pictures. That is fine on 4G and slow on weak signal.
- The poster PDF is about 3.5 MB, which keeps the QR code sharp.
- Backups stay in the same AWS region as the photos, by the owner's decision.
