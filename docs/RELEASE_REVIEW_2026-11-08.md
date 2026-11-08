# Release readiness review — 8 November 2026

Branch reviewed: fixes/suggested-fixes, starting at ee0bed1.
Decision: do not merge to main yet.

## Fixes in this review
- Corrected the native-dialog test's Windows filesystem path conversion with fileURLToPath.
- Normalized CRLF input in the chair invitation source test so Windows checkouts are supported.
- Added a deterministic private-path exposure probe for .orchestrate/README.md; the deployment check no longer depends on an ignored local folder existing.

## Validation
- Node 22 full local suite: 442 passed, zero failed, 57 skipped. Skips include emulator-dependent and live-host checks; they are not counted as passes.
- The earlier three application fixes remain committed in ee0bed1. Their new regression and related Firestore suites passed in the preceding implementation review.
- Previously deployed Firestore rules were independently verified against ee0bed1.
- Vercel reports the ee0bed1 fixes-branch preview READY, but fetching /api/admin-health returns HTTP 503 with NOT_CONFIGURED.
- Vercel environment metadata confirms all five required variables are Production-only. The service-account variable is sensitive and its value cannot be retrieved through the connected tool.

## Release blockers / remaining verification
- Configure appropriate Preview values for FIREBASE_SERVICE_ACCOUNT_JSON, PHOTO_BUCKET_API_URL, FIREBASE_WEB_API_KEY, DEMO_SERVICE_ADMIN_UID and CRON_SECRET, scoped to the fixes branch. Prefer a staging backend for tests that create or change data. Redeploy the preview afterwards.
- Run authenticated deployment health checks and the admin/customer/guest walkthrough against that configured deployment before promoting it.
- The previously reported production dependency audit has eight moderate affected-package entries associated with the UUID advisory; remediation and compatibility testing remain outstanding.
- Real-device upload/resume/restore, accessibility and cloud backup/IAM validation have not been certified by this review.

Main has not been changed. A successful Vercel build alone does not establish that the application is ready to release.
