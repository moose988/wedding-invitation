import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';

// Timeouts stay well under the 29 s API limit so a stuck connection becomes a retry, not a gateway timeout.
// maxAttempts 4: S3 SlowDown on a cold bucket clears within a few retries (load test). Beyond that the API answers 503 BUSY.
const checksums = { requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 4 };
export function createClients(env = process.env) {
  const requestHandler = { connectionTimeout: 2000, requestTimeout: 10000 };
  return {
    doc: DynamoDBDocumentClient.from(new DynamoDBClient({ requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 } }), { marshallOptions: { removeUndefinedValues: true } }),
    // Without these the SDK signs a checksum of an empty body into presigned PUT URLs. Operations that truly need a
    // checksum, such as DeleteObjects, still get one.
    s3: new S3Client({ requestHandler, ...checksums }),
    backupS3: new S3Client({ region: env.BACKUP_REGION, requestHandler, ...checksums }),
  };
}
