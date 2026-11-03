// 200 devices at once against the real handler and store, over a fake table that keeps item locks while a transaction
// is in flight, injects extra TransactionConflicts and enforces conditions. Run on its own with: npm run test:concurrency
import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeDynamo, counterTotals, harness, jpeg, pages } from './helpers.mjs';

const DEVICES = Number(process.env.DEVICES || 200), PHOTOS = 3;
// At the real load the default mint limits stay on, with every device behind one venue address. The 10x run
// (DEVICES=2000) measures the commit path, so it lifts them: the fake clock never moves on to a new minute.
const limits = DEVICES > 200 ? { mintPerBucket: 1e9, mintPerIp: 1e9 } : {};
const RETRIES = DEVICES > 200 ? 400 : 40;
const busyTable = () => new FakeDynamo({ latency: () => Math.random() * 2, hold: () => 2 + Math.random() * 6, conflictRate: 0.03 });
// What the frontend adapter must do: retry 5xx except 507, and 429, with a pause. Anything else is an answer.
async function retrying(work, seen) {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const r = await work(); seen.statuses.set(r.status, (seen.statuses.get(r.status) || 0) + 1);
    if ((r.status < 500 && r.status !== 429) || r.status === 507) return r;
    assert.notEqual(r.status, 500, `a 500 escaped: ${JSON.stringify(r.body)}`);
    await new Promise(done => setTimeout(done, 5 + Math.random() * 25));
  }
  throw new Error(`device gave up: ${JSON.stringify(Object.fromEntries(seen.statuses))}`);
}
async function device(h, id, n, assets, seen, { photos = PHOTOS, size } = {}) {
  const guest = (await retrying(() => h.call('POST', `/b/${id}/guest`, { ip: '10.0.0.1' }), seen)).body;
  const results = [];
  for (let p = 0; p < photos; p++) {
    const pid = `d${n}-p${p}`, image = size ? { buffer: assets.image, size } : assets.image;
    const grant = await retrying(() => h.upload(guest.token, id, pid, image, assets.thumb), seen);
    if (grant.status === 507) { results.push({ pid, status: 507 }); continue; }
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    const commit = () => h.call('POST', `/b/${id}/photos/${pid}/commit`, { token: guest.token, body: { uploadId: grant.body.uploadId, name: `Device ${n}` } });
    // Every fifth photo: the response is "lost", so the device commits again, in parallel with itself.
    const answers = await Promise.all(p % 5 === 0 ? [retrying(commit, seen), retrying(commit, seen)] : [retrying(commit, seen)]);
    const ok = answers.filter(a => a.status === 200);
    if (!ok.length) { results.push({ pid, status: answers[0].status, code: answers[0].body?.code }); continue; }
    assert.ok(ok.every(a => a.body.id === pid && a.body.revision === 1), JSON.stringify(answers.map(a => a.body)));
    results.push({ pid, status: 200, bytes: ok[0].body.size });
  }
  return { guest, results };
}

test(`${DEVICES} devices on one bucket: no lost photos, no duplicates, counters exact, no 500s, META untouched`, async () => {
  const h = harness({ dynamo: busyTable(), ...limits }), assets = { image: await jpeg(1200, 900), thumb: await jpeg(200, 150) };
  const id = (await h.createBucket({ gb: 15 })).body.id, seen = { statuses: new Map() };
  const metaBefore = h.dynamo.dump().find(i => i.pk === `BUCKET#${id}` && i.sk === 'META');
  const startedAt = Date.now();
  const devices = await Promise.all(Array.from({ length: DEVICES }, (_, n) => device(h, id, n, assets, seen)));
  const expected = DEVICES * PHOTOS, each = assets.image.length + assets.thumb.length, t = counterTotals(h.dynamo, id);
  for (const d of devices) assert.ok(d.results.every(r => r.status === 200), JSON.stringify(d.results));
  const stored = h.dynamo.dump().filter(i => i.pk === `BUCKET#${id}` && i.sk.startsWith('PHOTO#'));
  assert.equal(stored.length, expected, 'every photo stored');
  assert.equal(new Set(stored.map(p => p.sk)).size, expected, 'no duplicates');
  assert.ok(stored.every(p => p.revision === 1), 'no double commit');
  assert.equal(t.bytes, expected * each); assert.equal(t.photos, expected); assert.equal(t.free + t.bytes, 15 * 1024 ** 3);
  assert.equal(JSON.stringify(h.dynamo.dump().find(i => i.pk === `BUCKET#${id}` && i.sk === 'META')), JSON.stringify(metaBefore), 'a commit never writes META');
  for (const key of stored.flatMap(p => [p.imageKey, p.thumbKey])) assert.ok(h.files.current(key), `object ${key} is there`);
  const sample = devices[0];
  assert.equal((await pages(h.call, `/b/${id}/photos`, { token: sample.guest.token, query: { limit: '2' } })).length, PHOTOS, 'guest pages through only their own');
  assert.equal((await pages(h.call, `/b/${id}/photos`, { token: 'customer-token', query: { limit: '50' } })).length, expected, 'owner pages through all');
  assert.ok(h.dynamo.stats.conflicts > 0, 'the fake really produced conflicts');
  console.log(JSON.stringify({ devices: DEVICES, photos: expected, ms: Date.now() - startedAt, ...h.dynamo.stats, responses: Object.fromEntries(seen.statuses) }));
});

test(`${DEVICES} devices race for the last of a 1 GB demo: the cap holds exactly and nothing is stranded`, async () => {
  const h = harness({ dynamo: busyTable(), ...limits }), assets = { image: await jpeg(1000, 800), thumb: await jpeg(100, 80) };
  const limit = 1024 ** 3, id = (await h.createBucket({ demo: true, gb: undefined })).body.id, seen = { statuses: new Map() }, size = 15 * 1024 ** 2;
  const devices = await Promise.all(Array.from({ length: DEVICES }, (_, n) => device(h, id, n, assets, seen, { photos: 1, size })));
  const results = devices.flatMap(d => d.results), won = results.filter(r => r.status === 200), lost = results.filter(r => r.status !== 200);
  const t = counterTotals(h.dynamo, id), each = size + assets.thumb.length;
  assert.equal(t.free + t.bytes, limit, 'limit = free + used, exactly');
  assert.ok(t.bytes <= limit, 'cap respected'); assert.ok(t.minFree >= 0, 'no shard overdrawn');
  assert.ok(lost.every(r => r.status === 507), JSON.stringify(lost.slice(0, 3)));
  assert.equal(t.bytes, won.length * each, 'every accepted photo is counted, no phantom bytes');
  assert.equal(won.length, Math.floor(limit / each), 'all the room was used, nothing stranded in shards');
  assert.equal(h.dynamo.dump().filter(i => i.pk === `BUCKET#${id}` && i.sk.startsWith('PHOTO#')).length, won.length);
  console.log(JSON.stringify({ accepted: won.length, refused: lost.length, usedGiB: t.bytes / limit, responses: Object.fromEntries(seen.statuses) }));
});

test('several buckets at once stay isolated under load', async () => {
  const h = harness({ dynamo: busyTable(), ...limits }), assets = { image: await jpeg(600, 400), thumb: await jpeg(60, 40) }, seen = { statuses: new Map() };
  const ids = []; for (let i = 0; i < 4; i++) ids.push((await h.createBucket({ gb: 15 })).body.id);
  const perBucket = Math.ceil(DEVICES / 4);
  await Promise.all(ids.flatMap((id, b) => Array.from({ length: perBucket }, (_, n) => device(h, id, n, assets, seen, { photos: b + 1 }))));
  ids.forEach((id, b) => assert.equal(counterTotals(h.dynamo, id).photos, perBucket * (b + 1), `bucket ${b}`));
});

test('after pause returns, no new photo gets in, even with commits in flight', async () => {
  const h = harness({ dynamo: busyTable(), ...limits }), assets = { image: await jpeg(600, 400), thumb: await jpeg(60, 40) };
  const id = (await h.createBucket({ gb: 15 })).body.id, guest = (await h.call('POST', `/b/${id}/guest`)).body;
  const grants = await Promise.all(Array.from({ length: 60 }, async (_, n) => ({ pid: `p${n}`, grant: await h.upload(guest.token, id, `p${n}`, assets.image, assets.thumb) })));
  const commit = ({ pid, grant }) => h.call('POST', `/b/${id}/photos/${pid}/commit`, { token: guest.token, body: { uploadId: grant.body.uploadId } });
  const early = grants.slice(0, 30).map(commit);
  const pause = await h.call('POST', `/b/${id}/pause`, { token: 'customer-token', body: { paused: true } });
  assert.equal(pause.body.paused, true);
  const after = await Promise.all(grants.slice(30).map(commit));
  assert.ok(after.every(r => r.status === 403), JSON.stringify([...new Set(after.map(r => r.status))]));
  await Promise.all(early);
  const t = counterTotals(h.dynamo, id);
  assert.equal(t.photos, h.dynamo.dump().filter(i => i.pk === `BUCKET#${id}` && i.sk.startsWith('PHOTO#')).length);
  assert.equal(t.free + t.bytes, 15 * 1024 ** 3);
});

test('uploads and deletes mixed together keep the counters exact', async () => {
  const h = harness({ dynamo: busyTable(), ...limits }), assets = { image: await jpeg(600, 400), thumb: await jpeg(60, 40) }, seen = { statuses: new Map() };
  const id = (await h.createBucket({ gb: 15 })).body.id;
  const devices = await Promise.all(Array.from({ length: 50 }, (_, n) => device(h, id, n, assets, seen)));
  await Promise.all(devices.flatMap((d, n) => [
    retrying(() => h.call('DELETE', `/b/${id}/photos/d${n}-p0`, { token: d.guest.token }), seen),
    retrying(() => h.call('DELETE', `/b/${id}/photos/d${n}-p0`, { token: 'customer-token' }), seen),
  ]));
  const t = counterTotals(h.dynamo, id), each = assets.image.length + assets.thumb.length;
  assert.equal(t.photos, 100); assert.equal(t.bytes, 100 * each); assert.equal(t.free + t.bytes, 15 * 1024 ** 3);
  const records = prefix => h.dynamo.dump().filter(i => i.sk.startsWith(prefix)).length;
  assert.equal(records('DELETED#') + records('TOMB#'), 50, 'each photo deleted exactly once, by whichever request won');
});
