# Branch report: `claude/event-combined`

Prepared 15 November 2026, before the event on Friday 20 November.

This branch joins the two pieces of work in progress so they can be tested and released together:

- the **invitation templates** work (branch `claude/wedding-invitation-review-f46a21`), and
- the **photo bucket stress-test fixes** (branch `claude/photo-bucket-stress-fixes`).

Nothing has been merged into `main`, and nothing on the live site has changed. Both original branches are untouched. In total, the branch is 165 files and about 9,200 added lines ahead of `main`. Most of that is template artwork, styles and tests.

## Status at a glance

| Area | Status |
|---|---|
| Merge of the two branches | Clean, no conflicts. Also brings in the 2 newest `main` commits the templates branch was missing. |
| Automated tests | 539 tests: 480 pass, **0 fail**, 59 skipped (they need the database emulator, see below). Backend: 82 of 82 pass. |
| Photo bucket under load | 400 guests, 2,733 photos: none missing, duplicated or damaged. |
| Pages under real production security headers | Every page loads with no security-policy violations. |
| Database security rules tests | **Not yet run.** The emulator they need could not be downloaded in the test environment. Must be run before release (see "Before you merge"). |
| Real phones | **Not yet done.** Needs a short rehearsal on real devices (see "Before you merge"). |

## 1. What the branch contains

### 1.1 Invitation templates (from `claude/wedding-invitation-review-f46a21`)

**Wedding templates** (chosen when creating a wedding or engagement event):

| Template | What guests experience |
|---|---|
| Floral Wedding (`layla-zaid`) | Existing design: an envelope opens into sculpted ivory florals. |
| Moonlit Conservatory | Redesigned: opening film, moonlit garden, record-player music, details as a printed insert card, map. |
| Pomegranate Courtyard (new) | Scratch a copper-foiled card to open a candlelit courtyard. |
| Mandoos (new) | Trace a string of pearls to unlock the bride's chest. |
| Yasmine (new) | Press and hold to stitch a tatreez star, then rise to a jasmine terrace. |
| Shiraa (new) | Lift the bride's veil to reveal the couple by the sea; arch countdown, turntable music. |

**Other templates:**
- **Petit Nuage** (new, gender reveal): hold the pearl balloon until it pops, then guess boy or girl.
- **Ember** (new, birthdays and celebrations): strike a match to light the candles, then the age rolls up.

All templates keep RSVP and seating. Each has an Arabic and English version and a sample mode used for previews.

**Customer templates page (new, `templates.html`):**
- A public page to send to customers, listing every design by event type (weddings, gender reveals, birthdays), in English or Arabic.
- Tapping a design opens it full screen, exactly as a guest would see it on their phone.
- "I want this one" opens WhatsApp with the template's name already typed.

**Admin "Templates" tab (new, in the admin workspace):**
- Copy the customer page link, either for all templates or for one event type.
- Set the WhatsApp number used by "I want this one". Empty means the support number, +971 50 461 1123.
- Hide or show each template on the customer page. Hidden templates are still available to admins in the event template picker.

**Changes outside design that come with the templates.** These go live when merged:
- `firestore.rules`:
  - The public invitation now also accepts the five new template names (pomegranate-courtyard, mandoos, yasmine, shiraa, ember).
  - New rule for `siteSettings/templateShowcase`: anyone may read it, because the public page needs it; only enabled platform admins may write it, and only with the exact fields the admin tab saves.
  - Nothing that already existed was loosened.
- `firebase.json` and `vercel.json`: the security policy now allows the site to show its own pages inside a frame (`frame-src 'self'`). The customer templates page needs this to open designs full screen. Outside sites still cannot frame the site.

### 1.2 Photo bucket fixes (from `claude/photo-bucket-stress-fixes`)

These come from the stress test run before the event. Only the photo bucket's own page files changed. There were no changes to the backend, its settings, the database rules or deployment.

1. **Arabic on the printed card PDF.** Arabic names and places came out with disconnected letters on all six card designs. They now print correctly.
2. **Host pause or admin freeze during upload.** Photos used to fail with a Retry button. They now wait on the phone and upload by themselves when uploads resume. A guest who opens the link during a freeze gets in automatically once it ends.
3. **Same guest with several tabs open.** Each photo is now sent by only one tab, and the tabs stay in sync. Before, photos showed false errors or stayed stuck on "Queued".
4. **Upload progress.** Progress now moves up to 95% while the photo is sent. Before, it sat at 25% on slow Wi-Fi.
5. **High-resolution cameras.** iPhone 48 MP and Samsung/Pixel 50 to 200 MP photos now upload, correctly rotated and shrunk. Only photos over about 210 MP are refused, with a clear message.
6. **Full bucket.** Guests are told to let the host know. The host page shows storage used, with a warning from 90%.
7. **Guests with more than 100 photos** see "100+ photos" instead of "100 photos".
8. **Warnings.** Refused photos are grouped by reason in their own box. The technical queue message is now plain English.
9. **Host page on small phones.** Buttons no longer break mid-word, and Arabic place names line up correctly.
10. **"Download all"** downloads every ZIP part with one tap.
11. **Local test server** (developers only, never live): fixed running out of memory under heavy load.

### 1.3 Fixes made on this branch (commit `aae98cb`)

1. **No useless Retry button for photos that can never upload.**
   - Before: a corrupt photo, or one too large to open, showed "Retry". Retrying could never work.
   - Now: it shows only "Remove", with the reason. The choice survives a page reload.
   - Network problems still show Retry, as before.
2. **Admin Templates tab could wipe its own settings.**
   - Before: if the stored settings failed to load (for example on a bad connection), the tab still let an admin flip a switch or save the number. Saving then overwrote the hidden-templates list and the WhatsApp number with blanks.
   - Now: everything is locked with "Reload this page to make changes" until the settings load.
3. **Security tests for the template rules.**
   - New tests (`tests/template-showcase-firestore.test.mjs`) check that:
     - every template a customer can pick publishes its invitation, and a made-up template name is refused;
     - anyone can read the templates page setting;
     - signed-out users, customers and disabled admins cannot write it, and nobody can list or delete it;
     - enabled admins can save it, but only with valid fields (no extra fields, a WhatsApp number of up to 15 digits, at most 50 hidden templates, their own user id, the server time);
     - other `siteSettings` documents stay closed.
   - `npm run test:security` now runs these. It also runs the existing invitation-template rule test, which no test script ran before.

## 2. How it was tested

All load and browser tests ran against a local copy of the real backend code on a disposable test server. **No live event, bucket or photo was touched.**

### 2.1 Automated tests
- Repo: 539 tests, 480 pass, 0 fail, 59 skipped. The skipped tests need the database emulator: the 57 existing ones plus the 2 new ones above.
- Backend: 82 of 82 pass.
- Includes the 2,000-device concurrency test.

### 2.2 Photo bucket under load (combined branch)

| Test | Result |
|---|---|
| Wedding night: 400 guests uploading | 2,733 photos saved. None missing, duplicated or damaged. No failed uploads. |
| Security and edge cases | All 20 checks behaved as expected. Damaged, fake or oversized photos are refused. Tampered upload links, forged or missing guest tokens and a token used on another bucket are refused. One guest cannot see or delete another's photos, and a host cannot upload or change the date. Two tabs editing the same photo conflict safely, and 10 identical uploads at once save one photo. |
| Host pause and resume | Photos wait during the pause, then upload by themselves. |
| Full bucket | 52 extra uploads correctly refused. Nothing lost. |
| Rush of guests joining at once | Handled. |
| Host page with 2,733 photos | Opens fast and loads thumbnails on demand. Viewer, sort, pause and QR code all work. |
| "Download all" | 25 ZIP parts containing all 2,733 photos. Every ZIP is intact. |
| Delete and restore | 20 of 20 restored. A second restore is correctly refused. |
| 8 phones uploading at once | 88 of 88 photos saved, no page errors. |
| Hard cases | 31-photo selection, mixed and corrupt files, rotated photos, editing, delete, reload mid-upload and offline then back online all pass. |
| Very large photos (Chrome) | 48, 108 and 200 MP photos upload correctly rotated. 243 MP is refused with a clear message and only "Remove". |
| Printed cards | All six designs print Arabic correctly. Every QR code scans to the right event, including long Arabic names. |

### 2.3 Production security headers

My earlier tests did not apply the site's security headers. This time the test server applied the real `vercel.json` redirects, rewrites and security headers to every response, the same way production does.

- **Every page** loads with no security-policy violations. That covers all top-level pages, all 10 invitation designs and the photo bucket pages. The few console messages left also appear on `main` and are expected: those pages need a real invitation link.
- **Photo bucket under these headers:** guest uploads (3 phones, 33 of 33), the host page, pause, the viewer and card PDFs all work.
- **Customer templates page under these headers:**
  - all 8 designs open full screen;
  - "I want this one" builds the right WhatsApp message for each;
  - the phone's back button returns to the list;
  - Arabic switches the page to right-to-left.
- **Admin Templates tab:** tested both when settings load (saving works and sends exactly the fields the rules allow) and when they fail (everything stays locked and nothing is saved).

### 2.4 Safari engine (WebKit)
- The guest flow passed, including Arabic, the camera photo, a 10-photo batch, editing, delete, pause and resume, and reload.
- Large photos passed when tested one at a time: 48 MP (also rotated), 108 MP and 200 MP. 243 MP is refused with a clear message.
- **Known limit of the test browser.** The WebKit test browser used here cannot store photo files in its local database: every attempt failed in a separate check. That pushes the app onto its backup path of keeping queued photos in memory. On that path the test browser sometimes stalls for a while, in roughly 1 run in 3. **The same happens with the code currently on `main`**, so it is not caused by this branch.
- iPhone Safari does store these files normally, so this is not expected on real iPhones. It must still be confirmed in the real-phone rehearsal below.

## 3. Before you merge into `main`

1. **Run the database security tests** on a computer with normal internet access:
   ```
   npm ci
   npx firebase-tools@15 emulators:exec --only firestore --project demo-wedding-security "npm run test:security"
   ```
   Java must be installed. All tests must pass. The rule changes are small and were reviewed by hand, but they have not yet run against the real rules engine.
2. **Real-phone rehearsal** (about 10 minutes) on a preview of this branch:
   - Use a demo bucket and two or three real phones, at least one iPhone (Safari) and one Samsung.
   - On each phone: open the guest link from a printed card's QR code, take a photo, choose 10 photos from the gallery, and check they appear on the host page.
   - On the iPhone, choose a few photos, lock the phone for a minute, unlock it, and check the photos finish uploading.
   - Pause uploads from the host page, add a photo on a phone, resume, and check it uploads by itself.
   - Open the customer templates page on a phone, open two designs, and tap "I want this one".
3. **Merge by Wednesday 18 November** at the latest, so there is a full day to check the live site before Friday.
4. After merging, check that the hosting picked up the new security header (`frame-src 'self'`). If it didn't, the customer templates page shows blank designs.

## 4. Known limits, not changed

- **Join limit (backend, left unchanged on purpose):** at most 1,000 guests per minute can join from the same network address. If the whole venue shares one Wi-Fi address and more than 1,000 guests try to join within the same minute, some wait 30 to 60 seconds and then get in automatically. This is unlikely at a wedding.
- **Templates page when its settings can't load:** if the database can't be reached within 6 seconds, the customer page shows every template, including hidden ones, rather than an empty page.
- **Not testable from the test environment:** real iPhones and Android phones, the live AWS backend under real load, and the venue's Wi-Fi.

## 5. Commits on this branch (newest first)

| Commit | Summary |
|---|---|
| `aae98cb` | Production-readiness fixes: final failures without Retry, admin tab save lock, security tests |
| `7a62b52` | Merge of the photo bucket fixes into the combined branch |
| `6fccdc7` | Photo bucket: second round of fixes from re-testing |
| `117d145` | Photo bucket: fixes from the pre-event stress test |
| `05201e2` | Templates page: fix black screen on back, always show the WhatsApp button |
| `cdbe8a1` | Customer templates page and admin Templates tab |
| `8400ca8`, `081b267`, `ba909ad`, `2c76668`, `da8423b`, `3dc9b0d`, `af6b790` | Yasmine and Shiraa designs and refinements |
| `513a2e1`, `f6c5a34` | Ember birthday template and its rule entry |
| `d15f861`, `d5eb704` | Petit Nuage gender reveal template |
| `cb1fbbf`, `3c9056e`, `0bcdeca` | Yasmine, Mandoos and Pomegranate Courtyard templates |
| `75bfdb5`, `b51f539`, `b57b847`, `8121cd6`, `a7cadf7`, `cab893e` | Moonlit Conservatory redesign |
| `4677d9e` | Script cache keys aligned for a clean merge |
