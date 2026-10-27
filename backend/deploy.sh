#!/usr/bin/env bash
# Usage: ./deploy.sh <event-id> <firebase-owner-uid[,uid2]> <site-origin[,more-origins]> <region> <backup-region>
# Deploys ONE event: its own DynamoDB table, S3 bucket, API and compressed-backup bucket.
set -euo pipefail
EVENT_ID=$1; OWNER_UIDS=$2; ORIGIN=$3; REGION=$4; BACKUP_REGION=$5
PROJECT=${FIREBASE_PROJECT_ID:-weddinginvitaion-b4f36}
cd "$(dirname "$0")"
aws cloudformation deploy --region "$BACKUP_REGION" --stack-name "pb-$EVENT_ID-backup" --template-file backup.yaml --parameter-overrides EventId="$EVENT_ID"
BACKUP_BUCKET=$(aws cloudformation describe-stacks --region "$BACKUP_REGION" --stack-name "pb-$EVENT_ID-backup" --query "Stacks[0].Outputs[?OutputKey=='BackupBucketName'].OutputValue" --output text)
# Linux/arm64 native image library for Lambda, installed from this Mac.
npm_config_os=linux npm_config_cpu=arm64 npm ci --omit=dev
SECRET=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "pb-$EVENT_ID" --query "Stacks[0].Parameters[?ParameterKey=='GuestTokenSecret'].ParameterValue" --output text 2>/dev/null || true)
[ -n "$SECRET" ] && [ "$SECRET" != "****" ] || SECRET=$(openssl rand -hex 32)
aws cloudformation package --region "$REGION" --template-file event.yaml --s3-bucket "${PACKAGE_BUCKET:?set PACKAGE_BUCKET to any S3 bucket in $REGION you own}" --output-template-file .packaged.yaml
aws cloudformation deploy --region "$REGION" --stack-name "pb-$EVENT_ID" --template-file .packaged.yaml --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
  --parameter-overrides EventId="$EVENT_ID" FirebaseProjectId="$PROJECT" OwnerUids="$OWNER_UIDS" AllowedOrigin="$ORIGIN" BackupBucketName="$BACKUP_BUCKET" BackupRegion="$BACKUP_REGION" GuestTokenSecret="$SECRET"
aws cloudformation describe-stacks --region "$REGION" --stack-name "pb-$EVENT_ID" --query "Stacks[0].Outputs" --output table
