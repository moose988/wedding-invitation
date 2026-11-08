import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { THEMES, themeOf, details } from '../photo-bucket/links.js';

const read = f => readFile(new URL(`../${f}`, import.meta.url), 'utf8').then(source => source.replace(/\r\n/g, '\n'));
const [allEvents, styles, handler] = await Promise.all(['all-events.html', 'photo-bucket/styles.css', 'backend/src/handler.mjs'].map(read));
const values = THEMES.map(([value]) => value);
const event = { name: 'Baby reveal', date: '2027-03-01', location: 'Garden Hall' };

test('the create form, the backend and the shared list offer the same themes', () => {
  assert.deepEqual([...allEvents.match(/<select name="bucketTheme">(.*?)<\/select>/)[1].matchAll(/value="([^"]+)"/g)].map(m => m[1]), values);
  assert.deepEqual(JSON.parse(handler.match(/const validTheme = value => (\[[^\]]+\])/)[1]), values);
  assert.ok(values.includes('gender_reveal'));
});

test('every theme has a guest background, a card design and an image file', async () => {
  for (const [value, , card] of THEMES) {
    const guest = styles.match(new RegExp(`\\.pb\\[data-theme="${value}"\\] \\{ --guest-theme:url\\('\\./([^']+)'\\)`));
    assert.ok(guest, `guest page background for ${value}`);
    assert.match(styles, new RegExp(`\\.pb \\.pb-poster--${card} \\{[^}]*url\\('\\./${guest[1].replace(/[.]/g, '\\.')}'\\)`), `card uses the same picture for ${value}`);
    await access(new URL(`../photo-bucket/${guest[1]}`, import.meta.url));
  }
});

test('details keep a valid theme, refuse an unknown one, and older buckets fall back to olive', () => {
  assert.equal(details({ ...event, theme: 'gender_reveal' }).theme, 'gender_reveal');
  assert.throws(() => details({ ...event, theme: 'neon' }), /valid theme/);
  assert.equal('theme' in details(event), false);
  assert.equal(themeOf({}), 'olive');
  assert.equal(themeOf({ theme: 'neon' }), 'olive');
  assert.equal(themeOf({ theme: 'gender_reveal' }), 'gender_reveal');
});
