# ADR 0001: One shared Photo Bucket backend hosting many buckets

Status: Proposed, built on branch `fixes/suggested-fixes`, not deployed. Date: 2026-11-02.

## Context

`backend/` deployed one stack per event. It needs to host many isolated buckets in one stack, each with up to 200 devices uploading at once and several buckets active together, designed for 10x. Live data must not be touched.

The old code had these specific problems: a fixed bucket id, so a second "create" silently returned the first; every commit transaction touching one META item; `TransactionConflict` surfacing as a 500; unpaginated in-memory filtering; a 20 MB file loaded into Lambda memory at commit; lossy backups skipped over a budget and deleted with the photo; no DLQ.

Amended the same day: the user replaced an initial 30-day soft delete with the delete rules in section 3.

## Decisions

### 1. Tenancy: shared table and S3 buckets, partitioned by bucket id

Considered: one stack per event (status quo: strongest isolation, but slow to provision and it cannot serve a platform); one S3 bucket per tenant (account limits, notification wiring per bucket); **single table and prefixes**, chosen.

Isolation relies on one rule: every key derives from the id in the path, and the id is authorized first. Cursors carry only a position, and the partition is re-applied on the server, so a forged cursor cannot reach across.

**Exception, deliberate:** unfinished uploads live under `incoming/<id>/`, not `buckets/<id>/incoming/`. S3 lifecycle prefixes cannot contain a wildcard, so only a top-level prefix can expire abandoned uploads without a cleanup function that would have to touch every bucket. All durable data is under `buckets/<id>/`.

### 2. The size cap: an allowance per counter shard

| Option | Cap | Commit throughput | Failure mode |
| --- | --- | --- | --- |
| One counter on META (old) | Exact | Tens a second, then conflicts | Hot item, pause and cap checks all conflict |
| Sharded counters, summed before writing | Overshoots by what is in flight | High | Unbounded under a burst |
| Reservation at presign, reconcile later | Soft | High | Abandoned reservations leak; needs a reconciler, and photos can be refused while space is really free |
| **Shards hold spendable allowance (`free`)** | **Exact, zero overshoot** | Scales with shard count | Stranded allowance near the cap, handled below |

Each shard has `free`, and `limit = sum(free) + sum(bytes)` is preserved by every operation, since each one is a transaction or a single-item update. A commit transaction is the photo `Put` plus one shard `Update` conditional on `free >= bytes`. DynamoDB conditions cannot do arithmetic between attributes, which is why `free` is stored rather than derived.

Stranding: when the chosen shard cannot pay, the code reads all shards (one query, about 1 RCU). If another can pay, it retries there. If the total suffices but no single shard does, a transaction moves allowance from donors, under conditions so it cannot go negative. Only a true shortage answers 507. Contention therefore only rises in the last moments before a bucket is full, which the 1 GB race test covers: all usable room is taken and nothing is stranded.

Pause and closure move onto the shards as well (`state`), because a `ConditionCheck` on META inside each commit would recreate the hot item. Pause writes META first, then flips each shard individually rather than in one 32-item transaction, which would keep losing to live commits. The response only returns after every flip, so "paused" is true once the caller sees it. A crash partway leaves some shards open until the call is repeated. That is safe to retry and only ever errs for the length of that retry.

Shards: 32, or 4 for demos (a 20 MB photo on 1 GB / 32 shards would exhaust a shard constantly).

Bound: the committed total never exceeds the limit. Real S3 usage can exceed it by things the limit does not count: uncommitted uploads (1 day), hidden originals (30 days), backups, and copies from a commit refused in its final instant. Deleting those at once could lose a parallel retry's photo, since it may be committing the exact keys. So a refused commit writes a tombstone, and the admin sweep purges them after its 5-minute grace only if no photo or audit record owns that upload by then. The load test saw 947 such copies in its overload runs and none in realistic ones.

### 3. Delete rules (user decision, replacing a 30-day soft delete)

| Actor | Result |
| --- | --- |
| Guest, own photo, or replacing it | Permanent at once: every version of original and thumbnail, incoming copies, backup. Quota released. No record |
| Customer or admin (admin is an implementer default, flagged for confirmation) | Hidden, quota released, `DELETED#` audit record. Backup kept until the bucket goes. Admin can restore from the backup |

Backups are only removed by a guest delete, an admin bucket delete, or demo expiry. The backup bucket therefore has no expiry rules at all, and audit records have no TTL. The main bucket keeps its 30-day noncurrent rule, which only reaches hidden originals, because the backup outlives them.

**Restore serves the quality-80 backup**, so it copies that over the image key and charges quota for its size. Backups have no thumbnails, so an owner delete leaves the thumbnail current rather than regenerating it in an API function. The audit record stays after a restore, marked restored, and a later delete of the same upload folds the previous entry into `earlier`. If a guest then deletes a restored photo, rule 1 wins and that record goes too.

**No backup yet.** An owner delete when the state is `pending` or `failed` does not touch the original. The audit record takes over the place in the unbacked index, the normal pipeline backs up from the still-current original, records it on the audit record, and only then adds the delete marker. So the copy always exists before the original can start to expire. Delete transactions are conditional on `backupState`, so a backup finishing at that instant forces a re-read rather than a stale record. A backup that never succeeds keeps the original until the bucket is deleted, which is the intended failure direction.

**Guest delete against a running backup.** The danger is a copy landing after the purge. Three layers: a backup that finds its record gone purges its own copy; a tombstone written in the delete transaction makes the admin sweep repeat the purge once more than one function timeout has passed (5 minutes, against 120 s), covering a function that died between upload and check, and a first purge that failed; and a redelivered message re-reads the record and writes nothing. A photo is hidden and its quota released in the transaction, so an S3 outage delays only the file removal. Tombstones hold ids only, and go at the sweep.

**Who holds version deletion.** `PhotoPurgeFunction` does, not the API role. The API invokes it synchronously with a tombstone id, so a guest delete stays immediate, typically adding one function call. The function reads the table and acts only if the tombstone exists and no live photo or audit record owns that upload; it cannot write to the table. Residual risk: a compromised API role can delete a photo record and write a tombstone, so it can still destroy photos one at a time, which `PhotoPurgeVolumeAlarm` is there to notice.

`@aws-sdk/client-lambda` is not a dependency and installs were out of scope, so `src/invoke.mjs` calls Lambda's Invoke HTTP endpoint directly, signed with `@smithy/signature-v4`, already present through the AWS SDK. It is now declared in `package.json` and the lockfile's root entry. If installs are approved, replacing this with the Lambda client is a small change. The signature is cross-checked by hand in a test, but has not been accepted by real AWS.

### 4. Two purge functions, and why demo cleanup cannot touch real buckets

Demo ids carry a `demo-` prefix, enforced by id validation and unavailable to any other bucket. The demo sweep's IAM role reaches only `BUCKET#demo-*` partitions, the `DEMO` index partition, and `buckets/demo-*` / `incoming/demo-*`. That is enforced by AWS regardless of code. The code also checks id shape, `demo === true` and expiry on the fresh record before acting, and takes no input from its event.

Admin deletion is a separate function with wider rights (it also repeats guest purges, see section 3), which acts only on records marked `deleting` and listed under `PURGE`, both set only by the authenticated API route. It runs on a schedule rather than being triggered by a message, so a lost message cannot strand a deletion.

Purge order is objects, then records, then META last. META's presence means "unfinished", and every step lists only what still exists, so any crash resumes cleanly on the next run. A backup in flight during the purge finds no record and purges its own copy; if it dies in that instant one copy can remain, since the backup bucket has no expiry rule. That window is one function run, and the risk is noted below.

### 5. Backups: S3 event to SQS to Lambda

Old: S3 invoked Lambda directly, so failures were lost after async retries. New: `s3:ObjectCreated:Copy` to a queue, then a DLQ after 5 receives, with partial batch responses. Copy-only filtering avoids an event for each browser PUT, and thumbnails do not end in `.jpg`, so only committed originals fire.

Race: the event can overtake the commit transaction it belongs to. The queue's 30 second delay absorbs nearly all of these. If the record is still absent the message is retried for 15 minutes, then dropped as a genuine orphan.

Each photo holds `backupState`. Unfinished photos sit in a sparse GSI2 partition, so "how many are unbacked" and "which ones" are small queries. Re-drive copies the object onto itself, which fires the same notification. This was chosen over an SQS client partly because `@aws-sdk/client-sqs` is not a dependency and installing packages was out of scope, and it also takes the same path as a real commit. It adds one noncurrent version per re-drive, which expires by itself.

### 6. Commit validation without loading the file

`HEAD` for the true size, then a 128 KB ranged read for the JPEG frame header, with one retry at 1 MB for JPEGs with long metadata. The size is what S3 says, not what the client claimed. Bad bodies behind a good header are caught when the backup fails, and show as `failed` on that photo.

### 7. Throughput numbers

| Item | Number | Why |
| --- | --- | --- |
| Device | 0.67 commit-path rps, up to about 3 rps peak | Upload + commit per photo at most every 3 s; gallery opening fetches thumbnail URLs 6 at a time |
| One bucket at peak | 200 x 3 = 600 rps | |
| API default | 1500 rps, 3000 burst | From the AWS load test: five large events at once peaked at about 190 rps, so about 8x headroom, and it stays under a 1,000 Lambda limit (3000 hit it first at 4,000 devices) |
| Reserved concurrency | 20 on PhotoPurgeFunction only | It reached 81 in a purge storm. The API is unreserved |
| Commits per bucket | about 67 a second | 200 devices at one photo per 3 s |
| Table partition | about 270 WCU per bucket at peak | Transactional writes cost double: photo + shard, plus a share on GSI1 |
| Single shard | about 2 commits a second | 32 shards share 67 a second, far under one item's limits |
| Backups | 50 concurrent | Lagging is acceptable because originals are already durable |

**10x on one bucket** (670 commits a second, about 2700 WCU) passes one partition's 1000 WCU limit until DynamoDB splits it, which it does for heat within minutes, and meanwhile retries answer. 10x across buckets is not constrained by the table: partitions differ. The API default would need raising to the account's 10,000 rps quota. **Check before launch: Lambda concurrency quota**, which on new accounts may be far under 1000, and Lambda scales by up to 1000 functions every 10 seconds.

A `DEVICES=2000` run of the local test passes with no lost photos and exact counters, with many more 503s that clients retry. It tests logic, not AWS.

### 8. Guest minting

Tokens are stateless and need no login, so bounds are fixed windows in the table: 1200 a minute per bucket and 300 a minute per hashed source address. The address limit must exceed a full venue behind one NAT, which makes it weak against someone spreading requests. HTTP APIs do not support WAF, so the route throttle (200 rps overall) is the outer limit. An unknown bucket id costs no write. Storage stays bounded by each bucket's cap regardless of how many tokens exist.

### 9. Monitoring and limits still open

Five alarms all notify a required SNS topic, and access logs are kept 30 days. HTTP APIs publish no throttle metric, so 429s come from an access log filter. **Reserved concurrency is not set.** A number cannot be justified without the account quota, and a wrong one would either starve functions or fail the deploy, so it is a load-test item along with the alarm thresholds and API limits. Not done from the review: CloudTrail data events, and CloudFront plus WAF.

### 10. Secret kept by the stack

The old `deploy.sh` rotated the guest secret on every run, because `NoEcho` hides the current value. On a shared stack that would sign out every guest of every bucket. It now lives in Secrets Manager, generated once and retained, and is resolved into the function's environment at deploy.

## Failure modes

| Failure | Result |
| --- | --- |
| Lambda dies after copy, before transaction | Client retries, same keys, commits once. If it never retries, the copies stay as orphans until the bucket goes |
| Commit refused after copying (full, paused, conflict) | Tombstone; the sweep removes the copies 5 to 10 minutes later unless a photo owns them |
| S3 throttles (SlowDown, bodiless 503) | SDK retries 4 times, then 503 `BUSY` with `Retry-After`, never 500 |
| First deploy fails | `RetainExceptOnCreate` lets rollback remove the empty data resources; `deploy.sh` clears a `ROLLBACK_COMPLETE` stack and enables table protection only after success |
| Upload truncated | Refused at commit: the last bytes must hold the JPEG end-of-image marker |
| Lambda dies after transaction, before response | Retry returns the existing photo |
| Parallel commits of one upload | One transaction wins, the others return that photo and leave its files alone |
| Crash midway through pause | Some shards remain open until the call repeats. Reported as failed to the caller, so it does |
| DynamoDB throttles or conflicts beyond retries | 503 `BUSY`, `Retry-After`. Never a 500 |
| Backup fails repeatedly | `failed` on the photo, DLQ, alarm; re-drivable. The original is unaffected |
| PhotoPurgeFunction fails or cannot be invoked | Photo already gone for users, quota released. Tombstone makes the sweep repeat it |
| Owner delete's S3 call fails | Photo hidden, quota released, backup safe, but the original has no marker and stays until the bucket goes. Logged |
| Backup keeps failing on a deleted photo | Original kept, counted as unbacked, re-drivable. Restore answers `BACKUP_NOT_READY` |
| Purge dies midway | META remains, next schedule resumes |
| Index lag | A guest's own new photo can take moments to show in their list; the commit response already returned it |

## Known limits

- A customer deleting many photos frees quota while backups and hidden originals keep costing money, with backups retained until the bucket goes. Guests no longer add to this, since their deletes purge.
- A backup function dying between its upload and its check, during a whole-bucket purge, can leave one orphan backup (no tombstone covers that case). Very unlikely, and not found by any listing.
- Rate windows are fixed, so a burst across a minute boundary can reach twice the limit.
- Owner lists can return short pages, since expired or deleted buckets are filtered after the query. `nextCursor` is what signals more.
- Not verified on AWS: templates are parsed and checked structurally only, with no `sam validate` or deployment. IAM conditions in particular should be proven on a disposable stack.

## Amendment: uploader names and event songs (2026-11-03)

- **Uploader names.** The hide mode removes contributor ids too, not just names. Ids are stable per guest, so a customer could otherwise group photos by person and re-identify someone. Admins keep both for moderation. Names are cut to 40 characters, not rejected, because the existing queue sends up to 60.
- **Songs.** Songs live in the photo bucket under `audio/`, outside every bucket's quota, backups and sweeps. The API role was granted `s3:DeleteObjectVersion` on `audio/*` only, because "replacing deletes the old one" and event deletion are admin-only and synchronous. Routing this through `PhotoPurgeFunction` would have widened that function's input beyond tombstones. Uploads never committed are removed at the next commit or delete for that event, not on a schedule.
