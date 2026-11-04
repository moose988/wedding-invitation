import { createHash, createHmac } from 'node:crypto';
import { SignatureV4 } from '@smithy/signature-v4';

class Sha256 {
  constructor(secret) { this.hash = secret ? createHmac('sha256', secret) : createHash('sha256'); }
  update(data) { this.hash.update(data); }
  async digest() { return new Uint8Array(this.hash.digest()); }
}

// Synchronous Lambda invoke over its HTTP API, because @aws-sdk/client-lambda is not a dependency here. Credentials come
// from the environment Lambda provides to every function. Rejects on any failure; the caller logs it and the sweep retries.
export function createPurgeInvoker({ functionName, region, fetchImpl = fetch, timeoutMs = 8000 }) {
  const signer = new SignatureV4({ service: 'lambda', region, sha256: Sha256, credentials: async () => ({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, sessionToken: process.env.AWS_SESSION_TOKEN }) });
  const hostname = `lambda.${region}.amazonaws.com`, path = `/2015-03-31/functions/${encodeURIComponent(functionName)}/invocations`;
  return async function invoke(tombstoneId) {
    const body = JSON.stringify({ tombstoneId });
    const signed = await signer.sign({ method: 'POST', protocol: 'https:', hostname, path, query: {}, headers: { host: hostname, 'content-type': 'application/json', 'x-amz-invocation-type': 'RequestResponse' }, body });
    const response = await fetchImpl(`https://${hostname}${path}`, { method: 'POST', headers: signed.headers, body, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    if (response.status !== 200) throw new Error(`Purge invoke answered ${response.status}`);
    if (response.headers.get('x-amz-function-error')) throw new Error('Purge function failed');
    return JSON.parse(text);
  };
}
