# Photo Bucket — local frontend demo

Photo Bucket is an independent event type. In **All Events → Create event**, select the third card, **Photo Bucket**. Enter only an event name, date and location. Creation exits before the legacy Firebase event handler. Wedding, Celebration and Gender Reveal retain their original creation paths and data models.

Run `npm run dev`, open `/dashboard-login.html`, and use your existing planner account. For disposable testing use the Auth and Firestore emulators (`npm run dev:emulator`) and `/dashboard-login.html?emulator=1`. Photo Bucket management reuses the existing `planner-session` Firebase Auth session and `browserSessionPersistence`. The management page starts Auth only; it does not initialize Firestore, Storage or Analytics. The pre-existing workspace/login still performs its normal account and role checks. No rules, backend config, Cloud Functions or existing event schema were changed.

After creation, your bucket appears separately in the workspace's **Photo Buckets** section. Management is `/photo-bucket-manage.html?bucket=ID`; the guest page is `/photo-bucket.html?bucket=ID#event=…`; the print view is `/photo-bucket-poster.html?bucket=ID`. Owner pages require the existing session, then check the authenticated UID against the local bucket's owner. They have no public owner-mode or login bypass. Sessions are tab-scoped by the existing app; use the same signed-in tab for management. New tabs may require sign-in.

## What the demo promises

- Actual selected images, local event edits, processed photos and pending jobs persist in IndexedDB across refreshes.
- Photos **do not transfer between devices**. Different browsers, browser profiles and origins have separate data. A phone scanning a laptop's QR can display the event but its locally saved photos do not appear on the laptop.
- Clearing browser/site data removes all local buckets, photos, queue files and the anonymous contributor identity. Private browsing and quota restrictions can prevent persistence.
- Client-side ownership filtering is **only a demo boundary**, not production privacy. Someone controlling the browser can inspect IndexedDB and call JavaScript directly. The guest UI and guest adapter expose only the current contributor's records. A future backend must enforce real owner authorization and guest photo ownership for every operation. Never trust an owner or contributor ID provided by a client.
- New local uploads are paused atomically at enqueue and again at commit. A pause on one browser cannot affect another browser without the future backend. Guests can still edit/delete previously saved photos while paused.
- The owner sees all contributors in the **same browser profile**. Demo fixtures are deliberately kept out of the management screen. In a local development/test harness, explicitly call `loadFixtures(ownerAdapter(uid), bucketId)` from `photo-bucket/fixtures.js` to load three repository-local photos (`images/gallery-1.jpg` through `gallery-3.jpg`), named Amelia, Oliver and Sofia. `ownerAdapter(uid).clearFixtures(bucketId)` removes only fixtures. Fixture records carry `source: 'fixture'` and deterministic fixture IDs; adding them is idempotent. New buckets are never seeded automatically.

## Files, memory and edits

Central policy is `photo-bucket/limits.js`: JPEG/PNG/WebP/AVIF, maximum 20 MiB each, 40 megapixels after decoding, 30 selections per batch, two concurrent processors, 200 MiB persistent pending-source budget. Camera accepts `image/*` with `capture="environment"`; gallery accepts `image/*` with `multiple`. Unsupported formats receive useful feedback. The camera capture hint depends on the device; its native picker may open the gallery instead. **Choose from gallery** is always available. One native camera selection is one photo; multi-shot capture is not promised. HEIC is not converted. Broken/unsupported decoders fail without a success claim.

Each processor decodes one file, respects EXIF orientation via `createImageBitmap({ imageOrientation: 'from-image' })`, flattens transparency on white, scales to a maximum 2560 px edge, writes JPEG, and makes a 480 px thumbnail. Original source files are retained only until commit/removal. Gallery reads contain thumbnails and metadata, not full photo blobs. Original filenames appear in the processing queue; downloads use safe stable `.jpg` names because saved images are processed JPEGs. File input cancellation and empty selections are no-ops. Repeated selection of the same file is intentionally a new photo; **retries** use the same job/photo ID and cannot duplicate a completed record.

The editor rotates the oriented bitmap in 90° steps, then applies a proportional rectangular crop in the **rotated coordinate system**. The exact same coordinate helper drives the visible crop frame and the saved pixels. Crop size and X/Y controls work with touch and keyboard. Replacement remains a draft until Save. Cancel discards the draft; decode failures, failed saves and stale revisions preserve the previous valid blob. `replace` atomically commits metadata, thumbnail and image with an expected revision, so an older tab cannot overwrite a newer edit. Native dialogs provide focus containment, Escape and focus restoration. Saving temporarily disables closing the editor to avoid promising cancellation after a commit has begun.

ZIP is a dependency-free, standards-based ZIP with CRC32 and stored JPEG entries. `makeZip` reads one blob at a time, uses Blob parts, yields between entries and reports progress. Safeguards: **128 MiB / 500 photos per ZIP**; use contributor filtering or individual downloads above that. Filtered ZIPs contain the visible contributor's photos. All filenames are generated, not interpreted as paths. No fake download or PDF action exists.

## Local progress and deterministic failures

`photo-bucket/transport.js` exports `mockTransport({ failures, delay, backoff })` and `uploadQueue({ adapter, bucketId, changed, transport })`. There is **no network upload**. Progress says “Local demo processing”; success says “Saved on this device” only after the IndexedDB transaction completes. Queue files and attempt counts survive refresh. Interrupted queued/processing jobs are resumed on page load; exhausted jobs require Retry. Retry keeps its existing ID, resets the bounded three-attempt budget, and uses exponential 350/700 ms backoff by default. Invalid images, storage failures and pauses do not automatically retry as temporary transport errors.

Failure controls exist **only in the explicit browser test harness**, `scripts/check-photo-bucket-browser.mjs`, never in the guest screen. It injects `mockTransport({ failures: () => 2 })` for transient failure, `failures: () => 99` for retry exhaustion, then a successful transport for manual recovery. The harness also uses the loopback-only `installTestTransport(transport)` export in `app.js` to demonstrate failures and the actual guest Retry button. Injection requires an idle guest queue; it cannot enable owner mode, runs only on loopback, and has no URL/storage switch. Tests also recommit a completed ID and verify no duplicate. To build another developer harness, inject these same exported interfaces. Do not add hidden public owner modes or production failure query parameters.

## QR, URLs and printing

Links reuse `share-link.js` origin handling. Optionally set `window.PHOTO_BUCKET_PUBLIC_ORIGIN = 'https://your-host.example'` from a same-origin config script loaded before `photo-bucket/app.js`. It must be HTTPS, contain no credentials and point to a host serving these frontend files at the root. The QR encodes the **actual guest URL**, not a placeholder. Localhost/loopback links are explicitly marked as local previews; a hosted URL is required for phone scanning. Deployment is not part of this change.

The minimal version-1 fragment contains only name/date/location; the query contains a stable random bucket ID. No Auth token, owner identity, private metadata or photos are included. Parsing validates version, length, ID syntax and a real ISO calendar date; rendering escapes text. The fragment is not sent to the static host. It is public display data and not a signed invitation or authorization credential.

An owner bucket's current local details take precedence over an old printed payload in that browser. In a fresh browser an older printed link displays its original details. A previously opened guest-only replica keeps the first locally opened details. Generate a new QR after editing for updated cards; **live metadata updates across browsers/devices need the future backend**. Bucket IDs do not change on edit.

QR uses the existing local `vendor/qrcode.min.js`, dark modules on plain white, an explicit four-module quiet zone and no overlays. The portrait A5 card is 148 × 210 mm, with a 75 × 75 mm QR including quiet zone (70 mm on the compact layout for unusually long event details). Botanical border artwork is the local vector `photo-bucket/assets/botanical.svg`. Use **Preview & print A5 card → Print / Save as PDF**. Print at 100%, A5 portrait, browser headers/footers off. Navigation and controls are hidden by `@media print`. Browser “Save as PDF” is supported; no direct PDF-export button is advertised.

## Backend handoff: replace these interfaces

`photo-bucket/adapter.js` is the only persistence implementation. UI modules never call IndexedDB. Keep these asynchronous contracts and atomic semantics when replacing it:

| Interface | Methods | Backend responsibility |
| --- | --- | --- |
| `ownerAdapter(authenticatedUid)` | `create(details)`, `list()`, `get(bucketId)`, `update(bucketId, details)`, `setPaused(bucketId, boolean)` | Authenticate the existing session server-side, authorize each bucket, validate details, maintain stable IDs and server timestamps. Never trust the UID argument. |
| Owner photo operations | `photos(bucketId)`, `image(bucketId, photoId)`, `delete(bucketId, photoId)` | Authorized/paginated metadata, signed blob access or streaming download, transactional deletion. |
| `anonymousIdentity()` | returns persistent contributor ID | Replace with a server-issued, scoped guest credential or capability. No guest login/PIN is required by the product. |
| `guestAdapter(contributorId)` | `open(publicDetails)`, `status(bucketId)`, `photos(bucketId)`, `image(bucketId, photoId)` | Resolve canonical public details/pause state; enforce bucket **and** contributor ownership for all reads. Never return other contributors' photos. |
| Persistent queue | `enqueue(bucketId, file, name)`, `jobs(bucketId)`, `jobFile(bucketId, jobId)`, `updateJob(bucketId, jobId, changes)`, `discardJob(bucketId, jobId)` | Maintain resumable upload state and idempotency keys; enforce limits, contributor ownership and pause. Local queue storage may remain client-side. `thumbnail` is an optional persisted small Blob on jobs. |
| Guest photo commit | `commit(bucketId, jobId, {blob, thumbnail})` | Idempotent atomic commit using the **job ID as photo ID**, recheck pause immediately before visibility, validate/sniff content and dimensions, enforce ownership. Recommit of an existing own photo ID returns that photo. |
| Guest edits | `replace(bucketId, photoId, image, expectedRevision)`, `delete(bucketId, photoId)` | Authorization on both IDs, optimistic revision checks, atomic replacement preserving old data on failure, actual blob deletion. |
| Demo-only fixtures | `addFixture(bucketId, key, contributor, image)`, `clearFixtures(bucketId)` | Keep these in development only; preserve source separation from guest data. |
| `mockTransport` / `uploadQueue` | `run(job, file, progress)`, `wait(attempt)` | Replace simulation with real upload progress/cancellation and recoverable error classification. Preserve idempotency and bounded concurrency. |

Metadata shape: bucket `{id, ownerId, name, date, location, paused, createdAt, updatedAt}`; photo `{id, bucketId, contributorId, name, source, thumbnail, size, createdAt, updatedAt?, revision}`. Photo bytes are fetched separately through `image`. Queue/source bytes live separately from metadata. Blobs and thumbnails are `Blob` values. Adapter operations reject with useful errors, including quota errors. UI promises success only after resolved commit. Before production, add server limits, image validation, guest authorization, retention/deletion policy, canonical public metadata resolution and scalable ZIP streaming. This implementation adds **no server**.

## Verification

```powershell
node --test tests/photo-bucket.test.mjs tests/event-category-contract.test.mjs tests/customer-event-controls.test.mjs tests/workspace-loading.test.mjs tests/auth-session-contract.test.mjs
# In another terminal: firebase emulators:start --only auth,firestore --project demo-wedding-security
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
node scripts/check-photo-bucket-browser.mjs
```

The browser harness requires Playwright and installed Chrome (already available in the development environment). It serves a disposable static test origin, creates synthetic users/events only in the demo emulators, uses real IndexedDB and the actual existing login, and writes screenshots, downloads, print PDF, results and a request audit to `.local-evidence/photo-bucket/`. Existing tests that require emulators still need their normal environment. Native camera picker behavior, physical QR scanning and real network upload retries need actual devices/a future backend; browser file injection does not verify those.
