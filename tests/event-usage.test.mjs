import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FREE_DAILY, PRICES, bucketEstimate, eventEstimate, money, shareOf, sizeText } from '../event-usage.js';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const GB = 1024 ** 3;

test('an event estimate follows what the pages actually read and write', () => {
  const counts = { guests: 500, seatingGuests: 500, checkinGuests: 500, invitationSecrets: 500, invitationTokens: 500, publicGuests: 500, tables: 50, seatAssignments: 400, seatOccupancy: 500, publicLayouts: 50, publicVenue: 6, publicSchedule: 8, dashboardUsers: 4 };
  const estimate = eventEstimate({ counts, seatingEnabled: true });
  assert.equal(estimate.records, 4019);
  assert.equal(estimate.people, 500);
  assert.equal(estimate.dashboardOpen, 500 + 50 + 400 + 500 + 500 + 3);
  assert.equal(estimate.invitationOpen, 3 + 8 + 50 + 6);
  assert.equal(estimate.everyoneOpensOnce, 500 * 67);
  assert.equal(estimate.everyoneReplies, 2000);
  assert.equal(estimate.backupDownload, estimate.records);
  assert.equal(eventEstimate({ counts, seatingEnabled: false }).invitationOpen, 11, 'with seating off the hall layout is not read');
});

test('a shared-link event and an empty event are handled', () => {
  const shared = eventEstimate({ counts: { genderRevealResponses: 120, genderRevealSessionKeys: 120, publicEvent: 1 }, eventCategory: 'gender_reveal' });
  assert.equal(shared.people, 120);
  assert.equal(shared.dashboardOpen, 123);
  assert.equal(shared.invitationOpen, 2);
  const empty = eventEstimate({});
  assert.deepEqual(empty, { records: 1, people: 0, dashboardOpen: 3, invitationOpen: 3, replyWrites: 4, everyoneOpensOnce: 0, everyoneReplies: 0, backupDownload: 1 });
  assert.equal(eventEstimate({ counts: { guests: -5, tables: NaN } }).records, 1, 'bad counts are treated as zero');
});

test('shares of the free daily allowance are written plainly', () => {
  assert.deepEqual(FREE_DAILY, { reads: 50000, writes: 20000 });
  assert.equal(shareOf(0, FREE_DAILY.reads), '0%');
  assert.equal(shareOf(10, FREE_DAILY.reads), 'under 0.1%');
  assert.equal(shareOf(1953, FREE_DAILY.reads), '3.9%');
  assert.equal(shareOf(33500, FREE_DAILY.reads), '67%');
  assert.equal(shareOf(75000, FREE_DAILY.reads), '150%', 'more than a whole day is shown as it is');
});

test('a photo bucket costs storage plus backups, by the gigabyte', () => {
  const cost = bucketEstimate({ usedBytes: 10 * GB, backupBytes: 4 * GB, limitGb: 15 });
  assert.equal(cost.storage.toFixed(4), (10 * PRICES.storagePerGbMonth).toFixed(4));
  assert.equal(cost.backup.toFixed(4), (4 * PRICES.backupPerGbMonth).toFixed(4));
  assert.equal(cost.total, cost.storage + cost.backup);
  assert.equal(cost.whenFull.toFixed(4), (15 * PRICES.storagePerGbMonth + 5 * PRICES.backupPerGbMonth).toFixed(4));
  assert.deepEqual(bucketEstimate({}), { storage: 0, backup: 0, total: 0, whenFull: 0 });
  assert.deepEqual(bucketEstimate({ usedBytes: 2 * GB }, { storagePerGbMonth: 1, backupPerGbMonth: 1 }).total, 2, 'prices can be replaced');
});

test('money and sizes are readable', () => {
  assert.equal(money(0), '$0.00');
  assert.equal(money(0.004), 'under $0.01');
  assert.equal(money(0.28), '$0.28');
  assert.equal(money(12.5), '$12.50');
  assert.equal(sizeText(0), '0 MB');
  assert.equal(sizeText(300 * 1024 ** 2), '300 MB');
  assert.equal(sizeText(2.5 * GB), '2.5 GB');
  assert.equal(sizeText(15 * GB), '15 GB');
});

test('the section is for administrators, says its figures are estimates, and escapes what it shows', () => {
  const section = read('usage-section.js');
  assert.match(section, /<summary>Usage and cost<\/summary>/);
  assert.match(section, /class="access-section usage-section"/, 'the same panel design as Access');
  assert.match(section, /estimates worked out from the event's size/);
  assert.match(section, /Approximate AWS storage prices/);
  for (const value of ['label', 'value', 'note', 'failure?.message']) assert.ok(section.includes(`esc(${value}`), `${value} is escaped`);
  assert.match(read('dashboard.js'), /isWeddingOwner\(\) \? '<div id="customerAccessPanel"><\/div><div id="eventUsagePanel"><\/div>' : ""/);
  assert.match(read('photo-bucket/app.js'), /online && bucket\.canAdmin \? '<div id="accessSection"><\/div><div id="usageSection"><\/div>' : ''/);
  const lib = read('api/_lib/event-backup.js');
  assert.match(lib.slice(lib.indexOf('export async function eventUsage(')).slice(0, 200), /await requireAdmin\(auth, db, token\)/);
});
