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
export function uploadQueue({ adapter, bucketId, changed = () => {}, transport = mockTransport() }) {
  const running = new Set(); let stopped = false, pumping = false;
  async function process(job) {
    try {
      // Three automatic attempts total. Manual retry resets this budget.
      while (job.attempts < 3 && !stopped) {
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
          if (error.retryable && job.attempts < 3) { changed({ ...job, state: 'retrying', error: 'Retrying local processing…' }); await transport.wait(job.attempts); continue; }
          const reason = error.retryable ? 'Automatic retries finished. Tap Retry to try local processing again.' : friendlyError(error);
          await adapter.updateJob(bucketId, job.id, { state: 'failed', error: reason }); changed({ ...job, state: 'failed', error: reason }); return;
        }
      }
      if (!stopped) { await adapter.updateJob(bucketId, job.id, { state: 'failed', error: 'Automatic retries finished. Tap Retry to try again.' }); changed({ ...job, state: 'failed' }); }
    } catch (error) { changed({ ...job, state: 'failed', error: friendlyError(error) }); }
    finally { running.delete(job.id); if (!stopped) void pump(); }
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
