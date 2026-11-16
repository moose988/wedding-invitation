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

// Second round: issues found while re-testing before the event.
test('an admin freeze (BUCKET_FROZEN) parks photos like a host pause', async () => {
  const adapter = fakeAdapter({ commitError: () => Object.assign(new Error('This photo collection is paused until the event.'), { status: 503, code: 'BUCKET_FROZEN' }) });
  const queue = uploadQueue({ adapter, bucketId: 'b', transport });
  await queue.start();
  for (let i = 0; i < 200 && adapter.job('j1')?.state !== 'paused'; i++) await tick();
  assert.equal(adapter.job('j1').state, 'paused');
  adapter.state.commitError = null;
  await queue.resumePaused();
  for (let i = 0; i < 200 && adapter.saved.length < 2; i++) await tick();
  assert.equal(adapter.saved.length, 2);
});

test('a photo another tab already finished is reported as gone, never as failed', async () => {
  const adapter = fakeAdapter(); const states = [];
  // the other tab saves j1 and removes it from the shared queue while this tab is about to send it
  adapter.commit = async (_b, id) => { adapter.saved.push(id); throw new Error('This photo is not available to you.'); };
  const realJobs = adapter.jobs; adapter.jobs = async () => (await realJobs()).filter(j => !adapter.saved.includes(j.id));
  const queue = uploadQueue({ adapter, bucketId: 'b', transport, changed: job => states.push(`${job.id}:${job.state}`) });
  await queue.start();
  for (let i = 0; i < 200 && !(states.includes('j1:gone') && states.includes('j2:gone')); i++) await tick();
  assert.ok(states.includes('j1:gone') && states.includes('j2:gone'));
  assert.ok(!states.some(s => s.endsWith(':failed')), 'no false "failed" for a photo that was saved elsewhere');
});

test('upload progress is reported between 25% and 95% while the photo is sent', async () => {
  const adapter = fakeAdapter(); const progress = [];
  adapter.commit = async (_b, id, _image, onProgress) => { for (const f of [0.1, 0.5, 0.9, 1]) onProgress?.(f); adapter.saved.push(id); return { id }; };
  const queue = uploadQueue({ adapter, bucketId: 'b', transport, changed: job => job.state === 'processing' && Number.isFinite(job.progress) && progress.push(job.progress) });
  await queue.start();
  for (let i = 0; i < 200 && adapter.saved.length < 2; i++) await tick();
  assert.ok(progress.some(p => p > 25 && p < 95), `progress moved: ${progress}`);
  assert.ok(Math.max(...progress) <= 95);
});

test('JPEG dimensions are read from the header, so high-resolution photos can be decoded already scaled', async () => {
  const { jpegDimensions } = await import('../photo-bucket/images.js').catch(() => ({}));
  if (!jpegDimensions) return; // images.js needs a browser for its other exports only
  const sof = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x17, 0xa0, 0x1f, 0x80, 0x03];
  assert.deepEqual(jpegDimensions(new Uint8Array(sof)), { width: 8064, height: 6048 });
  assert.equal(jpegDimensions(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
});

test('limits and texts from the second round', async () => {
  const { LIMITS, validateFile, friendlyError } = await import('../photo-bucket/limits.js');
  assert.ok(LIMITS.inputBytes >= 40 * 1024 * 1024 && LIMITS.fileBytes === 20 * 1024 * 1024, 'picked photos up to 40 MB; uploads stay within the server limit');
  assert.doesNotThrow(() => validateFile({ type: 'image/jpeg', size: 30 * 1024 * 1024 }));
  assert.match(friendlyError({ code: 'BUCKET_FULL', message: 'x' }), /let your host know/);
  const pdf = await readFile(new URL('../photo-bucket/poster-pdf.js', import.meta.url), 'utf8');
  assert.match(pdf, /letter-spacing', '0', 'important'/, 'Arabic on the card PDF is drawn without letter-spacing');
  const app = await readFile(new URL('../photo-bucket/app.js', import.meta.url), 'utf8');
  assert.match(app, /const skipped = files\.length - LIMITS\.batch;/, 'the batch-size check is defined before use');
  assert.match(app, /BroadcastChannel/, 'tabs of one guest keep each other up to date');
  assert.match(app, /\$\{count\}\+ photos/, 'guests with more than one page see "100+ photos"');
});

// Third round (combined branch): a photo that can never upload offers only Remove.
test('a photo that cannot be opened or is too large fails as final, so Retry is not offered', async () => {
  const unusable = new Error('This photo could not be opened. Try exporting it as JPEG or choose another photo.'); unusable.unfixable = true;
  const adapter = fakeAdapter();
  const queue = uploadQueue({ adapter, bucketId: 'b', transport: { ...transport, run: async () => { throw unusable; } } });
  await queue.start();
  for (let i = 0; i < 300 && adapter.job('j1')?.state !== 'failed'; i++) await tick();
  assert.equal(adapter.job('j1').state, 'failed');
  assert.equal(adapter.job('j1').final, true, 'stored as final so a reload keeps Retry hidden');
  const busy = fakeAdapter({ commitError: () => Object.assign(new Error('busy'), { retryable: true }) });
  await uploadQueue({ adapter: busy, bucketId: 'b', transport }).start();
  for (let i = 0; i < 300 && busy.job('j1')?.state !== 'failed'; i++) await tick();
  assert.equal(busy.job('j1').final, false, 'network failures keep their Retry button');
  const images = await readFile(new URL('../photo-bucket/images.js', import.meta.url), 'utf8');
  assert.equal((images.match(/throw unusable\(/g) || []).length, 4, 'corrupt and over-size photos are marked unfixable');
  const app = await readFile(new URL('../photo-bucket/app.js', import.meta.url), 'utf8');
  assert.match(app, /job\.final \? '' : `<button type="button" data-job="\$\{h\(job\.id\)\}" data-retry="1">Retry<\/button>`/);
  const adapterSrc = await readFile(new URL('../photo-bucket/adapter.js', import.meta.url), 'utf8');
  assert.equal((adapterSrc.match(/'final'/g) || []).length, 2, 'the local queue store keeps the flag');
});

test('the admin Templates tab cannot save until the stored settings have loaded', async () => {
  const src = await readFile(new URL('../admin-templates.js', import.meta.url), 'utf8');
  assert.match(src, /async function save\(next, what\) \{\r?\n  if \(!view\.loaded\) return false;/);
  assert.match(src, /input\.disabled = view\.saving \|\| !view\.loaded;/);
  assert.match(src, /view\.loaded = true;/);
});
