# Photo Bucket backend handoff

Photo Bucket is currently a browser-only demo. Its UI depends on the asynchronous contracts in `photo-bucket/adapter.js` and `photo-bucket/transport.js`; replace those implementations with API-backed adapters without changing the UI. Keep the existing sign-in flow for owners. Do not trust client-supplied owner or contributor IDs.

## Data shapes

- **Bucket:** `{ id, ownerId, name, date, location, paused, createdAt, updatedAt }`. Keep `id` stable when details change.
- **Photo metadata:** `{ id, bucketId, contributorId, name, source, thumbnail, size, createdAt, updatedAt?, revision }`. Store photo bytes separately; `image()` returns a `Blob` in the current browser implementation.
- **Upload job:** `{ id, bucketId, contributorId, name, size, filename, createdAt, attempts, state, error, thumbnail? }`. The job ID becomes the photo ID, making commit/retry idempotent.

## Adapter methods to replace

- `ownerAdapter(uid)`: `create(details)`, `list()`, `get(bucketId)`, `update(bucketId, details)`, `setPaused(bucketId, paused)`, `photos(bucketId)`, `image(bucketId, photoId)`, and `delete(bucketId, photoId)`.
- `anonymousIdentity()`: replace the browser-local ID with a server-issued guest credential scoped to the bucket/contributor. Guests still have no login or PIN.
- `guestAdapter(contributorId)`: `open(publicDetails)`, `status(bucketId)`, `photos(bucketId)`, `image(bucketId, photoId)`, `enqueue(bucketId, file, name)`, `jobs(bucketId)`, `jobFile(bucketId, jobId)`, `updateJob(bucketId, jobId, changes)`, `discardJob(bucketId, jobId)`, `commit(bucketId, jobId, image)`, `replace(bucketId, photoId, image, expectedRevision)`, and `delete(bucketId, photoId)`.
- `mockTransport()` / `uploadQueue()`: replace deterministic local simulation with real upload progress, cancellation, recoverable error classification, and bounded concurrency. Keep success tied to completed server persistence.
- `addFixture()` / `clearFixtures()` are demo-only; do not expose them in production.

## Required authorization and consistency

Authenticate the existing owner session server-side and authorize every bucket operation against its stored `ownerId`; never accept the adapter's `uid` as proof. For every guest read, edit, replacement, and delete, validate **both** `bucketId` and the server-issued `contributorId`. An owner gallery can list all contributors only after owner authorization. Recheck bucket pause state when an upload commits, not only when it is queued. Commit by job ID atomically and idempotently. Replace with an expected revision and preserve the prior image if validation or storage fails. Validate MIME by content, dimensions and size on the server. Add retention/deletion policy and scalable ZIP downloads.

The versioned URL fragment contains only public event name/date/location; it is not an authorization token. A backend should resolve current public details for fresh and older links. Do not put credentials, owner identity, contributor secrets, or photos in URLs.

Local uploads today do not transfer between devices; browser profiles have separate data and clearing browser data deletes local records. Client-side ownership checks are only a demo boundary. This handoff describes future integration points; this branch adds no server or backend configuration.
