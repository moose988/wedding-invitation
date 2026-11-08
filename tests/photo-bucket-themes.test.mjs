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

test('the A5 card hides the date and place unless an admin switches them on', async () => {
  const app = await read('photo-bucket/app.js');
  const start = app.indexOf('async function renderPoster()');
  const poster = app.slice(start, app.indexOf('`;', start)); // the card's markup only
  assert.match(poster, /<h2>\$\{h\(bucket\.name\)\}<\/h2><div class="pb-card-meta" id="cardMeta"\$\{bucket\.cardShowsDetails \? '' : ' hidden'\}>/);
  assert.match(poster, /\$\{bucket\.canAdmin \? `<label>Card design.*id="posterDetails".*` : ''\}/, 'only admins get the switch');
  assert.match(styles, /\.pb \.pb-card-meta\[hidden\] \{ display:none; \}/);
});

test('guests see the date and place unless an admin switched them off; hosts always see them', async () => {
  const app = await read('photo-bucket/app.js');
  assert.match(app, /const meta = \(\) => !owner && bucket\.guestShowsDetails === false \? '' :/);
  assert.match(allEvents, /name="bucketGuestDetails" checked/);
  assert.match(allEvents, /name="bucketCardDetails" \/>/);
});

test('the main guest button takes each theme colour, and themes without one keep the default green', () => {
  assert.match(styles, /\.pb \.pb-primary \{ background:var\(--accent,var\(--ink\)\);color:var\(--accent-ink,#fffdf6\);border-color:var\(--accent-line,var\(--ink\)\); \}/);
  for (const value of ['garden', 'twilight', 'gender_reveal', 'baby_shower']) assert.match(styles, new RegExp(`\\.pb\\[data-theme="${value}"\\] \\{ --ink:#`), `${value} has its own colours`);
  for (const value of ['olive', 'memories']) assert.doesNotMatch(styles, new RegExp(`\\.pb\\[data-theme="${value}"\\] \\{ --ink:`));
});

test('on a themed guest page the upload panel is frosted glass, not a pop-up style card', () => {
  const rule = styles.match(/\.pb\[data-theme\] \.pb-upload \{([^}]*)\}/)[1];
  assert.match(rule, /box-shadow:none/);
  assert.match(rule, /border-color:transparent/);
  assert.match(rule, /backdrop-filter:blur\(/);
  assert.match(rule, /background:color-mix\(in srgb, var\(--white\) \d+%, transparent\)/);
});
