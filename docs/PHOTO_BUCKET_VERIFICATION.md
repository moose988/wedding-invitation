# Photo Bucket verification — 27 October 2026

Implementation and screenshots were checked in Chrome using Playwright, real IndexedDB, and the existing planner login against **local demo-project Auth and Firestore emulators**. No deployment or push was performed.

## Results

- Repository `node --test`: **206 passed, 0 failed, 9 skipped** (215 discovered). Emulator-dependent tests remain subject to their existing environment requirements.
- Focused feature/auth/workspace/category regression suite: **22 passed, 0 failed**.
- `scripts/check-photo-bucket-browser.mjs`: **32 end-to-end checks passed**. The harness creates disposable synthetic users and legacy events only in the emulators.
- Downloaded PNG QR decoded with jsQR and matched the complete guest URL exactly.
- Downloaded ZIP opened with Python `zipfile`: **9 unique JPEG files**, valid image signatures, all CRC checks passed.
- Standard and maximum-length-detail print PDFs: **one A5 page each**, approximately 148 × 210 mm, no navigation. Maximum-length text was checked against poster bounds and QR bounds. Rasterized print output was visually inspected.
- Browser audit: **no uncaught page errors, no Photo Bucket console errors, no Photo Bucket data/file requests to Firestore, Storage, Analytics or other data backends**. Owner pages download the existing Firebase SDK modules and use Auth; importing the shared config does not start Firestore or Analytics. Guest pages make no Firebase requests. The request log records URLs/methods, not token bodies or file contents.

## Coverage

| Requested flow | Evidence |
| --- | --- |
| Wedding and Celebration remain unchanged | Created both through the real existing dialog and verified successful emulator saves. Gender Reveal's existing contract tests pass. |
| Independent Photo Bucket, no Firebase creation | Only three enabled detail fields. Firebase wedding count unchanged after bucket creation. Local bucket has a separate random ID. |
| Metadata edit and refresh | Owner name/location edited and preserved across reload, with stable ID and updated public payload. |
| Guest skips optional name | Guest page immediately offers camera/gallery with name entry collapsed. |
| One/multiple selected real images | Real repository JPEG files selected, progress shown, save completion verified and reloaded. |
| Temporary failure, exhaustion, manual retry | Deterministic injected transport tested both through adapter callbacks and the actual guest UI Retry button. Three-attempt budget verified. |
| No duplicates | Completed ID recommitted with unchanged count. Interrupted persisted queue job resumed on page load. Manual retry produces one photo. Two concurrent processors observed. |
| Crop, rotate, replace, cancel, delete | Actual blob hashes/dimensions compared; cancel unchanged, replacement same ID/count, confirmed deletion. |
| Failed replacement | Broken JPEG rejected. Injected quota failure during atomic replacement rolls metadata back and preserves prior image bytes. This is a simulated quota error, not a claim that the physical disk was filled. |
| Contributor and owner isolation | Contributor A denied B's image, edits, delete, queued source, job changes/discard and commit. Cross-bucket access and wrong-owner gallery access denied. |
| Owner gallery and filter | Local guest contributors plus explicitly invoked fixture contributors visible. Contributor filter returns the expected single image. |
| Downloads | Full-screen viewer and real individual download checked; ZIP contents/CRC checked separately. |
| Pause/resume | Pause blocks initial enqueue and a previously queued commit. Resume permits new local attempts. |
| Unauthenticated management | Clean browser redirected to the existing planner login. No owner-mode bypass. |
| QR and public payload | Exported QR decoded exactly. Clean browser rendered public event details without original IndexedDB or guest Auth. |
| Print layout | Normal and 100-character name / 160-character location fit A5 without clipping or QR overlap. Controls hidden in print media. |
| Mobile layouts | Guest and owner inspected at 320, 375, 390, 430 px, plus desktop. No horizontal page overflow. Editor footer fits short portrait and landscape viewports. Optional-name keyboard entry tested. |
| Orientation | JPEG with explicit EXIF orientation 6 processed with an additional 90° rotation and crop. Output dimensions and expected blue reference pixel verified. |
| Partial failure/cancellation | Valid JPEG + corrupt JPEG + HEIC batch continues independently; unsupported feedback and empty-selection no-op verified. |
| Console/network | Recorded audit shows no Photo Bucket backend data calls and no feature console/page errors. |

## Artifacts

All runtime artifacts are in `.local-evidence/photo-bucket/` (intentionally ignored by Git):

- `guest-320.png`, `guest-375.png`, `guest-390.png`, `guest-430.png`, `guest-1280.png`
- `owner-gallery.png`, `mobile-editor.png`, `poster.png`
- `poster-a5.pdf`, `poster-a5-long-details.pdf`, `poster-print-render.png`, `poster-long-print-render.png`
- `qr.png`, `qr-decode.json`, `guest-url.txt`
- `individual.jpg`, `photos.zip`, `zip-check.json`
- `results.json`, `network.json`, `unit-tests.log`

Local links in these synthetic artifacts use the disposable test origin on port 4174 and are not deployed phone links. Test browser profiles are disposable. To try your own persistent collection, run `npm run dev`, sign in through the normal planner login, and create a new Photo Bucket. Explicitly add samples in management when desired.

## Actual-device and backend limits

No actual phone camera picker, multi-shot camera behavior, physical printed-card scanning or production privacy was tested or claimed. Camera capture hints and gallery fallback were verified in DOM and browser file injection. Real network upload/retry behavior is **not implemented**; progress and failure are deterministic local simulation. Local uploads cannot reach an owner in another device/browser/profile. Live cross-device metadata, pause, guest authorization and delivery require the future backend described in [PHOTO_BUCKET.md](./PHOTO_BUCKET.md).
