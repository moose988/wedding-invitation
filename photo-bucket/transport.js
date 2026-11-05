import { processImage } from './images.js';
import { LIMITS, friendlyError } from './limits.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Explicit deterministic mock transport; never calls fetch or any backend.
export function mockTransport({ failures = () => 0, delay = 100, backoff = 350 } = {}) {
  return {
    async run(job, file, progress) {
      const image = await processImage(file);
      await progress(8, image.thumbnail);
      for (const value of [24, 45, 65]) { await sleep(delay); await progress(value); }
      if (job.attempts <= failures(job)) { const error = new Error('A temporary demo processing interruption occurred.'); error.retryable = true; throw error; }
      await progress(90); return image;
    },
    wait: attempt => sleep(backoff * 2 ** (attempt - 1)),
  };
}
// Real uploads: the adapter's commit() sends the processed photo to the server and reports retryable network errors.
// Retries use full jitter (a random wait between 0 and the capped exponential delay) so a crowd of
// phones does not retry in step, and honour error.retryAfter (seconds) when the server sends it.
export const jitteredWait = (attempt, error, { backoff = 1000, cap = 30000, random = Math.random } = {}) =>
  sleep(Number(error?.retryAfter) > 0 ? Math.min(Number(error.retryAfter), 60) * 1000 : Math.floor(random() * Math.min(cap, backoff * 2 ** (attempt - 1))));
// Real (not simulated) failures get this many automatic tries, with full jitter between them.
// Time spent offline is not counted: see waitOnline and the queue below.
export const NETWORK_WAIT_LIMIT = 120; // network waits per photo, each 5-20 s: roughly 30 minutes
const networkWaits = new Map();
export const ONLINE_ATTEMPTS = 10;
// Resolves when the browser reports it is online again (the online event, or the tab becoming
// visible while online), with a slow poll as a safety net. Never rejects.
export function waitOnline({ poll = 5000 } = {}) {
  return new Promise(resolve => {
    const ready = () => typeof navigator === 'undefined' || navigator.onLine !== false;
    if (ready()) return resolve();
    let timer;
    const done = () => { if (!ready()) return; clearInterval(timer); window.removeEventListener('online', done); document.removeEventListener('visibilitychange', done); resolve(); };
    window.addEventListener('online', done); document.addEventListener('visibilitychange', done); timer = setInterval(done, poll);
  });
}
export function liveTransport({ backoff = 1000 } = {}) {
  return {
    maxAttempts: ONLINE_ATTEMPTS, online: true, waitOnline,
    async run(job, file, progress) { const image = await processImage(file); await progress(25, image.thumbnail); return image; },
    wait: (attempt, error) => jitteredWait(attempt, error, { backoff }),
  };
}
export function uploadQueue({ adapter, bucketId, changed = () => {}, transport = mockTransport() }) {
  const running = new Set(); let stopped = false, pumping = false;
  const maxAttempts = transport.maxAttempts || 3;
  async function process(job) {
    try {
      // Automatic attempts: 3 for the local demo, 10 online. Manual retry resets this budget.
      while (job.attempts < maxAttempts && !stopped) {
        job = await adapter.updateJob(bucketId, job.id, { attempts: job.attempts + 1, state: 'processing', error: '' });
        changed({ ...job, progress: 0 });
        try {
          const status = await adapter.status(bucketId);
          if (status.paused) throw new Error('Your host has paused new photos. Retry after uploads resume.');
          const file = await adapter.jobFile(bucketId, job.id);
          const image = await transport.run(job, file, async (progress, thumbnail) => {
            if (thumbnail) job = await adapter.updateJob(bucketId, job.id, { thumbnail });
            changed({ ...job, progress });
          });
          // The adapter checks pause again inside the atomic save transaction.
          await adapter.commit(bucketId, job.id, image);
          changed({ ...job, state: 'saved', progress: 100 }); return;
        } catch (error) {
          // A dropped connection is not a failed attempt: give the attempt back, pause until the phone is online
          // again (minutes if needed), then try the same photo again. The commit is idempotent (job id = photo id).
          // Venue Wi-Fi often stays "connected" with no internet, so a request that never reached the server
          // (error.network) counts the same, up to about 30 minutes of waiting before normal retries resume.
          const offline = globalThis.navigator?.onLine === false;
          if (transport.online && (offline || (error.network && (networkWaits.get(job.id) || 0) < NETWORK_WAIT_LIMIT))) {
            networkWaits.set(job.id, (networkWaits.get(job.id) || 0) + 1);
            job = await adapter.updateJob(bucketId, job.id, { attempts: Math.max(0, job.attempts - 1), state: 'processing', error: '' });
            changed({ ...job, state: 'waiting', error: 'Waiting for a connection…' });
            if (offline) await transport.waitOnline();
            else await (transport.networkWait ? transport.networkWait() : sleep(Math.floor(Math.random() * 15000) + 5000));
            if (stopped) return;
            await (transport.networkWait ? transport.networkWait() : sleep(Math.floor(Math.random() * 3000)));
            continue;
          }
          if (error.retryable && job.attempts < maxAttempts) { changed({ ...job, state: 'retrying', error: transport.online ? 'The service is busy. Trying again shortly…' : 'Retrying local processing…' }); await transport.wait(job.attempts, error); continue; }
          const reason = error.retryable ? (transport.online ? 'The upload did not go through after several tries. Tap Retry.' : 'Automatic retries finished. Tap Retry to try local processing again.') : friendlyError(error);
          await adapter.updateJob(bucketId, job.id, { state: 'failed', error: reason }); changed({ ...job, state: 'failed', error: reason }); return;
        }
      }
      if (!stopped) { await adapter.updateJob(bucketId, job.id, { state: 'failed', error: 'Automatic retries finished. Tap Retry to try again.' }); changed({ ...job, state: 'failed' }); }
    } catch (error) { changed({ ...job, state: 'failed', error: friendlyError(error) }); }
    // The wait allowance covers the whole automatic run of a photo; a manual Retry starts a fresh one.
    finally { networkWaits.delete(job.id); running.delete(job.id); if (!stopped) void pump(); }
  }
  async function pump() {
    if (stopped || pumping) return; pumping = true;
    try {
      for (const job of await adapter.jobs(bucketId)) {
        if (running.size >= LIMITS.concurrency) break;
        if (job.state === 'failed' || running.has(job.id)) continue;
        running.add(job.id); void process(job);
      }
    } catch (error) { changed({ state: 'queue-error', error: friendlyError(error) }); }
    finally { pumping = false; }
  }
  return { start: pump, stop: () => { stopped = true; }, get idle() { return !running.size && !pumping; }, async retry(jobId) { if (running.has(jobId)) return; await adapter.updateJob(bucketId, jobId, { attempts: 0, state: 'queued', error: '' }); await pump(); } };
}
