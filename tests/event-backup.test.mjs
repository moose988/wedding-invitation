import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GeoPoint, Timestamp } from 'firebase-admin/firestore';
import { BACKUP_FORMAT as SERVER_FORMAT, BACKUP_VERSION as SERVER_VERSION, NESTED_COLLECTIONS, RESTORE_PAGE_DOCS, decodeValue, encodeValue, validCollectionPath } from '../api/_lib/event-backup.js';
import { BACKUP_FORMAT, BACKUP_VERSION, RESTORE_CHUNK_DOCS, backupFileName, chunkDocs, downloadEventBackup, readBackupText, restoreEventBackup, summarizeBackup } from '../event-backup.js';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fakeDb = { doc: (path) => ({ path }) };

test('browser and server agree on the backup format', () => {
  assert.equal(BACKUP_FORMAT, SERVER_FORMAT);
  assert.equal(BACKUP_VERSION, SERVER_VERSION);
  assert.ok(RESTORE_CHUNK_DOCS <= RESTORE_PAGE_DOCS, 'a browser chunk must fit one server page');
});

test('every nested collection in the rules is covered by the backup', () => {
  const lines = read('firestore.rules').split('\n');
  const start = lines.findIndex((line) => /^ {4}match \/weddings\/\{weddingId\} \{/.test(line));
  assert.ok(start > 0);
  const nested = {};
  let parent = null;
  for (const line of lines.slice(start + 1)) {
    if (/^ {4}\}/.test(line)) break;
    const top = /^ {6}match \/([A-Za-z]+)\/\{[A-Za-z]+\} \{/.exec(line);
    if (top) { parent = top[1]; continue; }
    const inner = /^ {8,}match \/([A-Za-z]+)\/\{[A-Za-z]+\} \{/.exec(line);
    if (inner) (nested[parent] ||= []).push(inner[1]);
  }
  assert.deepEqual(nested, Object.fromEntries(Object.entries(NESTED_COLLECTIONS).map(([key, value]) => [key, [...value]])));
});

test('values survive encoding and decoding exactly', () => {
  const original = {
    text: 'Layla & Zaid', count: 3, ratio: 1.5, flag: false, nothing: null,
    when: new Timestamp(1_700_000_000, 123_000_000), place: new GeoPoint(25.2, 55.3),
    list: [1, 'two', { deep: new Timestamp(5, 0) }], marker: { __t: 'looks like a marker', other: 1 }, odd: Number.POSITIVE_INFINITY,
  };
  const encoded = JSON.parse(JSON.stringify(encodeValue(original)));
  const decoded = decodeValue(fakeDb, encoded);
  assert.ok(decoded.when instanceof Timestamp && decoded.when.isEqual(original.when));
  assert.ok(decoded.place instanceof GeoPoint && decoded.place.isEqual(original.place));
  assert.ok(decoded.list[2].deep.isEqual(original.list[2].deep));
  assert.deepEqual(decoded.marker, original.marker);
  assert.equal(decoded.odd, Number.POSITIVE_INFINITY);
  assert.deepEqual({ ...decoded, when: 0, place: 0, list: 0 }, { ...original, when: 0, place: 0, list: 0 });
});

test('unknown or damaged markers are refused', () => {
  for (const value of [{ __t: 'nope' }, { __t: 'ts', s: 'x', n: 0 }, { __t: 'ts', s: 1, n: -1 }, { __t: 'ref', path: 'weddings' }, { __t: 'num', v: '7' }, { __t: 'map', v: [] }]) {
    assert.throws(() => decodeValue(fakeDb, value), (error) => error.code === 'INVALID_BACKUP', JSON.stringify(value));
  }
  assert.throws(() => encodeValue(new Map()), (error) => error.code === 'BACKUP_UNSUPPORTED_VALUE');
});

test('only collections inside one event are accepted as paths', () => {
  for (const path of ['guests', 'senderCapabilities/abc/recipients']) assert.equal(validCollectionPath(path), true, path);
  for (const path of ['', 'guests/abc', 'a/b/c/d/e', '../clients', 'guests/../x', '__reserved__', 'a//b', 7, null]) assert.equal(validCollectionPath(path), false, String(path));
});

test('chunks respect both the record and the size limit and lose nothing', () => {
  const docs = Array.from({ length: 25 }, (_, index) => ({ id: `g${index}`, data: { note: 'x'.repeat(100) } }));
  const byCount = [...chunkDocs(docs, 10, 1_000_000)];
  assert.deepEqual(byCount.map((chunk) => chunk.length), [10, 10, 5]);
  const bySize = [...chunkDocs(docs, 100, 400)];
  assert.ok(bySize.every((chunk) => chunk.length <= 3) && bySize.length > 8);
  assert.deepEqual(bySize.flat(), docs);
  assert.deepEqual([...chunkDocs([{ id: 'big', data: { note: 'x'.repeat(5000) } }], 10, 100)].length, 1, 'one oversized record still goes out');
});

// A stand-in for the server: holds one event the way the API reports it.
function fakeServer(seed) {
  const state = { event: seed.event, collections: structuredClone(seed.collections), cards: seed.cards, grants: seed.grants, calls: [], beginRounds: 2, staged: {} };
  state.post = async (body) => {
    state.calls.push(body.action);
    if (body.action === 'export-start') return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: '2026-11-10T08:30:00.000Z', exportedBy: 'admin@example.test', eventId: 'event-1', event: state.event, collections: [...Object.keys(state.collections), 'emptySection'], cards: state.cards, grants: state.grants };
    if (body.action === 'export-page') {
      const all = state.collections[body.path] || [];
      const from = body.cursor ? all.findIndex((row) => row.id === body.cursor) + 1 : 0;
      const docs = all.slice(from, from + 2);
      return { path: body.path, docs, next: from + 2 < all.length ? docs.at(-1).id : null };
    }
    if (body.action === 'restore-begin') { state.event = null; state.collections = {}; state.staged = {}; state.beginRounds -= 1; return { done: state.beginRounds <= 0 }; }
    if (body.action === 'restore-write') { (state.staged[body.path] ||= []).push(...body.docs); return { written: body.docs.length }; }
    if (body.action === 'restore-finish') { state.finish = body; state.event = body.event; state.collections = state.staged; return { ok: true, eventId: body.eventId, ownerChanged: false }; }
    throw new Error(`unexpected ${body.action}`);
  };
  return state;
}
const SEED = {
  event: { eventTitle: 'Layla & Zaid', eventCategory: 'wedding_engagement', ownerUserId: 'admin-1', createdAt: { __t: 'ts', s: 1, n: 0 } },
  collections: {
    guests: [{ id: 'g1', data: { fullName: 'A' } }, { id: 'g2', data: { fullName: 'B' } }, { id: 'g3', data: { fullName: 'C' } }],
    tables: [{ id: 't1', data: { name: 'One' } }],
    'senderCapabilities/cap1/recipients': [{ id: '0000', data: { recipients: [] } }],
    dashboardUsers: [{ id: 'admin-1', data: { role: 'owner' } }],
  },
  cards: [{ uid: 'admin-1', data: { eventTitle: 'Layla & Zaid' } }],
  grants: [{ id: 'grant-1', data: { weddingId: 'event-1', email: 'c@example.test' } }],
};

test('a download pages through every section and a restore puts the same data back', async () => {
  const server = fakeServer(SEED);
  const progress = [];
  const backup = await downloadEventBackup({ post: server.post, eventId: 'event-1', onProgress: (step) => progress.push(step.records) });
  assert.deepEqual(backup.collections, SEED.collections);
  assert.equal(backup.collections.emptySection, undefined, 'empty sections are left out');
  assert.deepEqual(backup.counts, { guests: 3, tables: 1, 'senderCapabilities/cap1/recipients': 1, dashboardUsers: 1 });
  assert.equal(progress.at(-1), 6);
  assert.match(backup.checksum, /^[a-f0-9]{64}$/);

  const reread = await readBackupText(JSON.stringify(backup));
  assert.deepEqual(summarizeBackup(reread), { eventId: 'event-1', title: summarizeBackup(reread).title, exportedAt: '2026-11-10T08:30:00.000Z', exportedBy: 'admin@example.test', guests: 3, tables: 1, responses: 0, members: 1, records: 7 });
  assert.match(backupFileName(reread), /^event-backup-[a-z0-9-]+-event-1-20261110-0830\.json$/);
  assert.match(backupFileName(reread, 'before-restore'), /-before-restore\.json$/);

  server.collections.guests.push({ id: 'later', data: { fullName: 'Added after the backup' } });
  server.calls.length = 0;
  const phases = [];
  const result = await restoreEventBackup({ post: server.post, backup: reread, onProgress: (step) => phases.push(step.phase) });
  assert.equal(result.ok, true);
  assert.deepEqual(server.collections, SEED.collections, 'the later guest is gone and everything else is back');
  assert.deepEqual(server.finish.expected, backup.counts);
  assert.deepEqual(server.finish.cards, SEED.cards);
  assert.deepEqual(server.finish.grants, SEED.grants);
  assert.deepEqual(server.calls.filter((name) => name === 'restore-begin').length, 2, 'clearing is repeated until the server says done');
  assert.equal(server.calls.at(-1), 'restore-finish');
  assert.deepEqual([...new Set(phases)], ['clear', 'write', 'finish']);
});

test('a restore that cannot clear the event stops before writing', async () => {
  const server = fakeServer(SEED);
  const backup = await downloadEventBackup({ post: server.post, eventId: 'event-1' });
  server.beginRounds = Infinity;
  await assert.rejects(restoreEventBackup({ post: server.post, backup }), /could not be cleared/);
  assert.equal(server.calls.includes('restore-write'), false);
});

test('files that are not sound backups are refused with a plain message', async () => {
  const server = fakeServer(SEED);
  const backup = await downloadEventBackup({ post: server.post, eventId: 'event-1' });
  await assert.rejects(readBackupText('not json'), /not a backup/);
  await assert.rejects(readBackupText(JSON.stringify({ format: 'something-else' })), /not an event backup/);
  await assert.rejects(readBackupText(JSON.stringify({ ...backup, version: 99 })), /different version/);
  await assert.rejects(readBackupText(JSON.stringify({ ...backup, collections: { guests: [{ id: '', data: {} }] } })), /incomplete or damaged/);
  const edited = structuredClone(backup); edited.collections.guests[0].data.fullName = 'Changed by hand';
  await assert.rejects(readBackupText(JSON.stringify(edited)), /changed or damaged/);
  const moved = { ...backup, eventId: 'another-event' };
  await assert.rejects(readBackupText(JSON.stringify(moved)), /changed or damaged/, 'the event a file belongs to cannot be edited');
});

test('the page offers backup and restore to administrators only', () => {
  const page = read('weddings.js');
  const adminOnly = /\$\{state\.isAdmin \? `[^`]*data-action="backup"[^`]*data-action="restore-backup"[^`]*` : ""\}/;
  assert.match(page, adminOnly, 'both menu buttons sit inside the admin-only part of the card menu');
  assert.match(page, /dataset\.action === "backup" && state\.isAdmin/);
  assert.match(page, /dataset\.action === "restore-backup" && state\.isAdmin/);
  assert.match(page, /restoreEventButton\.hidden = !state\.isAdmin \|\| customerView/);
  assert.match(read('all-events.html'), /id="restoreEventButton" type="button" hidden/);
  assert.doesNotMatch(read('customer-events.html'), /restoreEventButton/);
  const handler = read('api/admin-event-backup.js');
  assert.match(handler, /req\.method !== 'POST'/);
  const lib = read('api/_lib/event-backup.js');
  for (const name of ['startEventExport', 'exportEventPage', 'beginEventRestore', 'writeEventRestorePage', 'finishEventRestore']) {
    const body = lib.slice(lib.indexOf(`export async function ${name}(`));
    assert.match(body.slice(0, 400), /await requireAdmin\(auth, db, token\)/, `${name} checks the caller first`);
  }
  assert.match(read('vercel.json'), /"api\/admin-event-backup\.js": \{\s*"maxDuration": 60/);
});
