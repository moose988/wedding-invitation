# Photo Bucket backend (one event per stack)

Each event gets its own CloudFormation stack: a DynamoDB table, a private S3 bucket, an HTTP API,
and a bucket of compressed backups in a second region. When the event is over, delete the stack.

| What | Where | Limit |
| --- | --- | --- |
| Full-quality photos (max 2560 px JPEG) + thumbnails | S3 `pb-<event>-...` (versioned, private) | 15 GB per event, enforced atomically |
| One record per photo, counters, pause flag | DynamoDB `pb-<event>` (point-in-time recovery on) | |
| Compressed copies (1600 px, JPEG q60, about 10-15% of original size) | S3 `pb-<event>-backup-...` in the backup region | 9 GB budget; copies beyond it are skipped and logged |

Photos are not stored inside DynamoDB (400 KB item limit). The table holds each photo's metadata and S3 key.

## Deploy an event

Needs the AWS CLI signed in, Node 22, and any S3 bucket in the target region for packaging.

```bash
export PACKAGE_BUCKET=my-deploy-bucket
./deploy.sh my-event <your-firebase-uid> https://weddinginvitaion-b4f36.web.app eu-north-1 eu-west-1
```

1. Copy the printed `ApiUrl` into `photo-bucket/config.js` (`API_URL`). Leave it empty to keep the local demo.
2. The CSP in `firebase.json` allows `eu-north-1`. For another region, change both `*.execute-api.<region>` and `*.s3.<region>` entries.
3. Sign in to the dashboard and create the Photo Bucket once. Only UIDs in `OwnerUids` can host; the first creation claims the event.

Find your Firebase UID in Firebase Console, Authentication, Users.

## Finish an event

1. Download the photos (owner page, ZIP) if the hosts want them.
2. Empty both photo buckets in the S3 console, including versions ("Empty" handles this).
3. Delete the stacks `pb-<event>` and `pb-<event>-backup`. The table, API and functions are removed with them.

## Restore from backup

Compressed copies live under `backup/<photoId>/` in the backup bucket. Originals deleted by mistake can also be
recovered for 30 days from the main bucket's previous versions, and the table can be restored to any second in the
last 35 days (point-in-time recovery).

## Tests

```bash
npm test
```
