# Photo Bucket backend (one shared stack, many buckets)

One CloudFormation stack hosts every photo bucket: one DynamoDB table, one private S3 bucket, one HTTP API, and one
backup bucket in a second region. Buckets are records and key prefixes, created through the API. Nothing is deployed per
event. The design and the alternatives are in [`docs/adr/0001-shared-photo-bucket-backend.md`](../docs/adr/0001-shared-photo-bucket-backend.md).
The old single-event stack (`flo4boqpu9`) is separate and untouched. No data is copied across. Its template is at commit `f44748f`.

| What | Where | Limit |
| --- | --- | --- |
| Photos (max 2560 px JPEG) and thumbnails | S3 `pbs-<stage>-...`, `buckets/<id>/photos/...` (versioned, private) | `limitBytes` per bucket, chosen by an admin from 15, 20, ... 50 GB; demos 1 GB |
| Unfinished uploads | same bucket, `incoming/<id>/...`, expire after 1 day | Not counted until committed |
| Records and counters | DynamoDB `pbs-<stage>`, partition `BUCKET#<id>` (PITR on) | |
| Backups (same dimensions, JPEG quality 80) | S3 `pbs-<stage>-backup-...`, `buckets/<id>/backup/...`, backup region (versioned) | No budget: every photo is backed up, none skipped |

`src/sizes.mjs` has no imports and can be mirrored by the frontend: the allowed sizes and
`estimatePhotos(gb) = floor(gb * 1024 / 3 * 0.8)`, which assumes about 3 MB a photo less a 20% margin. It is an estimate
for people. Only bytes are enforced, and a photo's bytes are its image plus its thumbnail.

## Deploy the stack

Needs the AWS CLI signed in, Node 22, any S3 bucket in the target region for packaging, and an SNS topic with a confirmed subscriber in that region. The topic is required, because every alarm notifies it.

```bash
export PACKAGE_BUCKET=my-deploy-bucket
./deploy.sh <admin-uid[,uid2]> https://weddinginvitaion-b4f36.web.app eu-north-1 eu-west-1 <alarm-sns-topic-arn>
```

1. Before the first deploy, check the account's Lambda concurrency quota. The default throttle (1500 rps, burst 3000, set from the AWS load test) needs roughly 200 to 450 concurrent functions; 1,000 is enough. `PhotoPurgeFunction` reserves 20 of them. Parameters `ApiRateLimit`, `ApiBurstLimit` and `BackupMaxConcurrency` adjust it. The API function is deliberately not reserved.
2. Copy the printed `ApiUrl` into `photo-bucket/config.js` (`API_URL`).
3. The CSP in `firebase.json` allows `eu-north-1`. For another region, change both the `*.execute-api.<region>` and `*.s3.<region>` entries.

Re-running `deploy.sh` is safe at any time.

**If the first deploy fails:** the table, photo bucket, backup bucket and secret use `RetainExceptOnCreate`. A rollback of their very first creation removes them, since they cannot hold data yet, and `deploy.sh` deletes a stack left in `ROLLBACK_COMPLETE` before trying again. Once a deploy has succeeded they are retained like `Retain`, and `deploy.sh` turns on table deletion protection. Protection is not in the template, because a protected table would block exactly that rollback. **Always deploy with `deploy.sh`**, or turn on protection by hand afterwards. The guest-token secret is generated once by the stack and survives redeploys. Rotating it signs out all guests of all buckets and detaches them from their photos.

`ADMIN_UIDS` is the only list of platform admins. Find a Firebase UID in Firebase Console, Authentication, Users. Owners are stored per bucket and changed through the API.

## Who can do what

Full routes, shapes and errors are in the API contract given to the UI builders. In short:

- **Guests** need no login. They mint a token bound to one bucket and only see and change their own photos.
- **Owners** manage buckets they are linked to: details, pause, all photos.
- **Admins** also create buckets, set size, change owners, freeze, delete, see backups, and list and restore deleted photos.

## Deleting

| Who or what | Effect | Undo |
| --- | --- | --- |
| Guest deletes or replaces their own photo | **Permanent at once**: original, thumbnail, all S3 versions and the backup copy are purged, quota released, no record kept | None |
| Customer or admin deletes a photo | Hidden and quota released. An audit record keeps photo id, name, contributor, who deleted it and when. The backup copy is kept until the bucket is deleted | Admin restore, for as long as the bucket exists |
| Admin deletes a bucket (`DELETE /b/<id>?confirm=<id>`) | Closed at once. A sweep within 5 minutes removes every object, version, backup and record | None |
| Demo expires (an admin picks 6, 12, 24, 48, 72 or 168 hours at creation, default 24) | API answers 410 at once. A sweep within 15 minutes removes everything | None |
| Non-demo bucket passes its date | Nothing. Admins see `overdue: true` from 48 hours after the end of the event date (UTC) | |

Those three deletions are the only ways a backup is removed. No lifecycle rule or TTL touches backups or audit records.

- **The restored photo is the quality-80 backup copy**, not the original. Quota is charged for that copy, and it keeps its thumbnail, which is retained for this purpose.
- **A customer deleting a photo with no backup yet** loses nothing. The original stays in place until the backup function has made the copy, then it is hidden. Until then restore answers `BACKUP_NOT_READY`. A backup that keeps failing keeps the original indefinitely, and shows in the counts below.
- **The original of a customer-deleted photo** expires 30 days after being hidden, under the main bucket's noncurrent-version rule. After that the backup is the only copy.
- **A guest delete while a backup is running** cannot leave a copy. The backup function checks after writing and purges its own copy. If it dies first, a short-lived tombstone item (bucket, photo id and upload id only) makes the admin sweep repeat the purge 5 to 10 minutes later. The same sweep finishes a first purge that failed.

The API role cannot delete versions. A guest delete invokes `PhotoPurgeFunction` synchronously with only a tombstone id; that function reads the table to check the tombstone exists and no live photo or audit record owns the upload, and its rights are limited to photo, incoming and backup keys. The API can only reach it by first removing the record, and the `PhotoPurgeVolumeAlarm` watches the volume. The demo sweep's role still reaches only `demo-*` keys, so it cannot touch another bucket whatever its code does. Table, buckets and the secret are retained if the stack is deleted after a successful create, and the table has deletion protection on.

## Backups

Each commit copies the photo into place, S3 tells the backup queue, and the backup function writes the copy. Copies stay until one of the deletions above. Five failures move the message to the dead-letter queue and raise the `BackupDlqAlarm` alarm. Every photo records `backupState` (`pending`, `failed`, `done`), and the unfinished ones are indexed.

```text
GET  /admin/backups            failed count across all buckets, and per bucket
GET  /b/<id>/backups           pending, failed and unbacked counts for one bucket, deleted photos included
POST /b/<id>/backups/redrive   re-sends up to 50 unbacked photos; pass nextCursor back until it is null
```

If the DLQ holds messages, fix the cause, then either use the re-drive above or move them back:

```bash
aws sqs start-message-move-task --source-arn <BackupDlq ARN> --destination-arn <BackupQueue ARN>
```

Backups lag at peak on purpose (`BackupMaxConcurrency`). Originals are already safe, and the queue keeps the backlog for 14 days.

To restore from a backup, copy from the backup bucket's `buckets/<id>/backup/<photoId>/`. The table can be restored to any second in the last 35 days (point-in-time recovery).

## Uploader names

Each bucket has `showUploaderNames` (default on), set by an admin at creation or later with `PATCH`. Guests may give a display name when joining or with an upload; it is stored per contributor (`CONTRIB#` items, removed with the bucket) and copied onto each photo. When the flag is off, customers' photo lists carry neither names nor contributor ids, and they cannot filter by contributor. Admins and the guest who took a photo always see the name.

## Event songs

Admins upload one MP3 per invitation event, at most 15 MB and signed for `audio/mpeg`. The upload goes to `audio/__uploads__/<eventId>/<uploadId>.mp3`, where a one-day lifecycle rule removes abandoned uploads. Commit validates two consecutive MPEG Layer III frames on a separate playback copy. The `EVENT#<eventId> / SONG` record switches to that copy only if the song revision still matches the revision when the upload was granted. Replacement and deletion permanently remove the previous playback key and its versions without touching concurrent uploads. The API role may delete versions under `audio/*` only. Anyone with the event id can get a 15-minute signed URL, cacheable for 5 minutes. Songs are not counted in bucket sizes or backed up.

## Monitoring

Every alarm notifies the required `AlarmTopicArn`. Thresholds are provisional until the load test.

| Alarm | Fires on |
| --- | --- |
| `BackupDlqAlarm` | A photo failed backup 5 times |
| `Api5xxAlarm` | More than 50 5xx in 5 minutes. Includes 503 `BUSY` and frozen buckets |
| `Api429Alarm` | More than 100 429s in 5 minutes, counted from the access log, since HTTP APIs have no throttle metric. Includes mint limits |
| `ApiFunctionThrottleAlarm` | Any Lambda concurrency throttle on the API function |
| `PhotoPurgeVolumeAlarm` | More than `PhotoPurgeAlarmThreshold` (1000) permanent deletes in 5 minutes |

Access logs go to the `ApiAccessLogs` log group for 30 days. They hold source address and path, never query strings or headers.

## Capacity

Each bucket has 32 counter shards (4 for demos). A commit is one transaction: the photo record plus one randomly chosen shard, which pays under the condition `free >= bytes`. `limit = sum(free) + sum(bytes)` always holds, so **the committed total cannot exceed the limit, by any amount**, however many writers race. Not counted against the limit: uploads not yet committed, hidden originals during their 30 days, backups (including those kept for deleted photos), and the copies of a commit refused in its last instant. Those are removed by the admin sweep 5 to 10 minutes later, unless a parallel retry of the same upload committed them by then.

Conflicts are retried with full jitter on another shard. If retries run out, or S3 answers `SlowDown` (a new bucket does under a sudden burst until it scales), the API answers 503 `BUSY` with `Retry-After`, never 500, and the client's retry is safe because commit is idempotent.

Guest token minting allows 1200 a minute per bucket and 1000 a minute per source address (a whole venue can share one address; the load test showed 300 turned away part of a 500-guest room that joined within one minute), plus a route throttle of 200 a second across all buckets.

## Tests

```bash
npm test                                   # everything
npm run test:concurrency                   # 200 devices against the real handler and store
DEVICES=2000 npm run test:concurrency      # 10x
```

The tests run the real `store.mjs` over `test/helpers.mjs`, an in-memory table that parses and evaluates expressions, holds item locks during transactions and injects `TransactionConflict`s. It proves the logic, not AWS latency or limits. Measuring those needs a disposable stack.
