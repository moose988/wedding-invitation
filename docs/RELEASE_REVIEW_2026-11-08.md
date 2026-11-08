# Release review — 8 November 2026

Branch: fixes/suggested-fixes. Application revision: 6fcd0eb (subsequent documentation changes do not alter deployed application files).

## Fixed

- Guest check-in and undo update canonical guest data and the restricted check-in projection together.
- Bulk RSVP updates use the guest-edit consistency path rather than updating only canonical records.
- Event deletion removes customer access grants in bounded batches; redemption refuses deleting or unavailable events.
- Windows test paths use fileURLToPath; source assertions normalize CRLF.
- The deployment exposure check always probes .orchestrate/README.md, even when the ignored folder is absent locally.
- RELEASE.md now documents staged production validation for Production-only secrets.

## Deployment configuration

The five required variables are scoped to Production in wedding-invitation-nlsf. Ordinary branch previews remain unconfigured. No production secrets were copied or broadened to other branches.

Built a production-target deployment with --skip-domain, leaving live aliases unchanged during validation:
https://wedding-invitation-nlsf-hhx28mu15-moose988s-projects.vercel.app

Deployment: dpl_B6wRW2DsY2dpvwonz3rceUi8zrEK. It uses the existing Production environment. All five API routes return expected unauthenticated 401 or method-rejection 405 responses rather than configuration errors.

## Verification

- Node 22 full local suite: 442 passed, zero failed, 57 skipped. Skipped tests are not counted as passes.
- Staged deployment: 50 available checks passed. Authenticated admin health was unavailable; the user explicitly requested continuation with available checks.
- Compression was independently verified for all four large assets via response headers. Windows curl cannot decode Brotli, so its initial decoding errors were verified separately.
- Live Firestore rules match the reviewed commit after newline normalization: SHA-256 e4558359fdabeadb6807fb2681ee27a486322b66db8c399fe236188dde2df518.
- The configured photo API answered the nonexistent-bucket probe with HTTP 404 and BUCKET_NOT_FOUND.
- A combined parallel emulator run encountered shared-fixture interference. The sequential rerun passed all 59 tests with zero failures and zero skips.

## Remaining limits

- Authenticated production admin/customer walkthroughs, real-device photo upload/resume/restore, accessibility, and cloud backup/IAM behavior are not certified by this review.
- Production dependency audit reports eight moderate package entries from [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). The advisory affects UUID v3/v5/v6 with external buffers. Inspected google-gax, gaxios and teeny-request callers use v4. No affected call path was found there; this is not a clean dependency audit. A tested dependency upgrade remains follow-up work.
- Firebase billing is disabled. Existing Spark-compatible Firestore behavior was tested; paid-service availability and quota capacity are not established.
- The AWS photo backend was checked for reachability, not redeployed or certified to match this branch in this release.

This release has bounded automated verification, not a guarantee that every production workflow is flawless.
