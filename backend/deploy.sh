#!/usr/bin/env bash
# Usage: ./deploy.sh <admin-uid[,uid2]> <site-origin[,more-origins]> <region> <backup-region> <alarm-sns-topic-arn> [stage]
# Deploys the ONE shared stack (pbs-<stage>, default pbs-shared). Run it once, then only for code or settings changes.
# It adds no per-event resources: buckets are created through the API. It never touches an old pb-<event> stack.
set -euo pipefail
[ $# -ge 5 ] || { sed -n 2,3p "$0"; exit 2; }
ADMIN_UIDS=$1; ORIGIN=$2; REGION=$3; BACKUP_REGION=$4; ALARM_TOPIC=$5; STAGE=${6:-shared}
case "$ALARM_TOPIC" in arn:aws:sns:*) ;; *) echo "The alarm topic must be an SNS topic ARN, so failed backups reach someone."; exit 2 ;; esac
PROJECT=${FIREBASE_PROJECT_ID:-weddinginvitaion-b4f36}
cd "$(dirname "$0")"
# A stack whose very first create failed sits in ROLLBACK_COMPLETE and refuses updates. That state holds no data, since
# creation never finished and every data resource is RetainExceptOnCreate, so it is safe to delete and start over.
clear_failed_create() {
  if [ "$(aws cloudformation describe-stacks --region "$1" --stack-name "$2" --query 'Stacks[0].StackStatus' --output text 2>/dev/null)" = ROLLBACK_COMPLETE ]; then
    echo "Removing $2, whose first create failed and rolled back."
    aws cloudformation delete-stack --region "$1" --stack-name "$2"
    aws cloudformation wait stack-delete-complete --region "$1" --stack-name "$2"
    sleep 61 # SQS refuses a queue name for 60 s after that queue was deleted
  fi
}
clear_failed_create "$BACKUP_REGION" "pbs-$STAGE-backup"
aws cloudformation deploy --region "$BACKUP_REGION" --stack-name "pbs-$STAGE-backup" --template-file backup.yaml --parameter-overrides Stage="$STAGE"
BACKUP_BUCKET=$(aws cloudformation describe-stacks --region "$BACKUP_REGION" --stack-name "pbs-$STAGE-backup" --query "Stacks[0].Outputs[?OutputKey=='BackupBucketName'].OutputValue" --output text)
# Linux/arm64 native image library for Lambda, installed from this Mac. Run plain `npm ci` afterwards to test locally again.
npm_config_os=linux npm_config_cpu=arm64 npm ci --omit=dev
clear_failed_create "$REGION" "pbs-$STAGE"
aws cloudformation package --region "$REGION" --template-file template.yaml --s3-bucket "${PACKAGE_BUCKET:?set PACKAGE_BUCKET to any S3 bucket in $REGION you own}" --output-template-file .packaged.yaml
# The guest-token secret is generated and kept by the stack, so a redeploy does not sign guests out.
aws cloudformation deploy --region "$REGION" --stack-name "pbs-$STAGE" --template-file .packaged.yaml --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND \
  --parameter-overrides Stage="$STAGE" FirebaseProjectId="$PROJECT" AdminUids="$ADMIN_UIDS" AllowedOrigin="$ORIGIN" BackupBucketName="$BACKUP_BUCKET" BackupRegion="$BACKUP_REGION" AlarmTopicArn="$ALARM_TOPIC"
# Protection goes on only now that creation succeeded (see template.yaml, Table). Re-running it is harmless.
TABLE=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "pbs-$STAGE" --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text)
aws dynamodb update-table --region "$REGION" --table-name "$TABLE" --deletion-protection-enabled >/dev/null
aws cloudformation describe-stacks --region "$REGION" --stack-name "pbs-$STAGE" --query "Stacks[0].Outputs" --output table
