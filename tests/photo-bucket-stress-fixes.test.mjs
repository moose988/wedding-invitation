// Regressions for the issues found in the November 2026 Photo Bucket stress test.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PAUSED_JOB_MESSAGE, isPausedError, uploadQueue } from '../photo-bucket/transport.js';

const tick = () => new Promise(r => setTimeout(r, 1));
function fakeAdapter({ paused = false, commitError } = {}) {
  const jobs = new Map(['j1', 'j2'].map(id => [id, { id, attempts: 0, state: 'queued', name: `${id}.jpg` }]));
  const saved = []; const state = { paused, commitError };
  return {
    saved, state,
    status: async () => ({ paused: state.paused }),
    jobs: async () => [...jobs.values()],
    jobFile: async () => new Blob(['x']),
    updateJob: async (_b, id, changes) => { const job = { ...jobs.get(id), ...changes }; jobs.set(id, job); return job; },
    commit: async (_b, id) => { if (state.commitError) throw state.commitError(); saved.push(id); jobs.delete(id); return { id }; },
    job: id => jobs.get(id),
  };
}
const transport = { online: true, maxAttempts: 3, waitOnline: async () => {}, networkWait: async () => {}, wait: async () => {}, run: async () => ({ blob: new Blob(['img']) }) };

test('a host pause parks photos instead of failing them, keeps their attempts, and they upload by themselves on resume', async () => {
  const adapter = fakeAdapter({ paused: true }), states = [];
  const queue = uploadQueue({ adapter, bucketId: 'b', transport, changed: job => states.push(job.state) });
  await queue.start();
  for (let i = 0; i < 200 && !['j1', 'j2'].every(id => adapter.job(id)?.state === 'paused'); i++) await tick();
  for (const id of ['j1', 'j2']) {
    assert.equal(adapter.job(id).state, 'paused');
    assert.equal(adapter.job(id).attempts, 0, 'a pause does not use up an attempt');
    assert.equal(adapter.job(id).error, PAUSED_JOB_MESSAGE);
  }
  assert.ok(!states.includes('failed'), 'never shown as failed, so no Retry tap is needed');
  await queue.start(); await tick();
  assert.equal(adapter.saved.length, 0, 'the queue does not hammer the server while paused');
  adapter.state.paused = false;
  assert.equal(await queue.resumePaused(), 2);
  for (let i = 0; i < 200 && adapter.saved.length < 2; i++) await tick();
  assert.deepEqual(adapter.saved.sort(), ['j1', 'j2']);
  assert.equal(await queue.resumePaused(), 0, 'nothing left to resume');
});

test('a pause the server reports at commit (UPLOADS_PAUSED) is parked the same way, with the same wording', async () => {
  const adapter = fakeAdapter({ commitError: () => Object.assign(new Error('Your host has paused new photos. Try again after uploads resume.'), { status: 403, code: 'UPLOADS_PAUSED' }) });
  const queue = uploadQueue({ adapter, bucketId: 'b', transport });
  await queue.start();
  for (let i = 0; i < 200 && adapter.job('j1')?.state !== 'paused'; i++) await tick();
  assert.equal(adapter.job('j1').state, 'paused');
  assert.equal(adapter.job('j1').error, PAUSED_JOB_MESSAGE);
  assert.ok(isPausedError({ code: 'UPLOADS_PAUSED' }) && isPausedError({ paused: true }) && !isPausedError(new Error('x')));
});

test('ordinary failures still end in Tap Retry (pause handling did not swallow them)', async () => {
  const adapter = fakeAdapter({ commitError: () => Object.assign(new Error('busy'), { retryable: true }) });
  const queue = uploadQueue({ adapter, bucketId: 'b', transport });
  await queue.start();
  for (let i = 0; i < 300 && adapter.job('j1')?.state !== 'failed'; i++) await tick();
  assert.equal(adapter.job('j1').state, 'failed');
});

test('guest page keeps skipped or refused photo warnings in their own box, and multi-part ZIPs keep their buttons', async () => {
  const app = await readFile(new URL('../photo-bucket/app.js', import.meta.url), 'utf8');
  assert.match(app, /id="uploadNotice"[^>]*role="alert"/, 'a dedicated warning box exists');
  assert.match(app, /showUploadNotice\(errors\.length \?/, 'selection errors go to that box');
  assert.doesNotMatch(app, /message\(errors\.length \?/, 'errors are no longer written to the status line that progress overwrites');
  assert.match(app, /data-zip-all="1"/, 'one button downloads every part');
  assert.match(app, /id="zipProgress"/, 'progress has its own line');
  assert.doesNotMatch(app, /\(done, total\) => \{ status\.textContent =/, 'progress no longer replaces the part buttons');
  assert.match(app, /setInterval\(async \(\) => \{[\s\S]{0,80}if \(disposed\)/, 'paused guests re-check status');
});

test('the photo editor crop controls are no longer hidden', async () => {
  const css = await readFile(new URL('../photo-bucket/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.pb-crop-controls[^{]*\{[^}]*display:\s*none/);
});
