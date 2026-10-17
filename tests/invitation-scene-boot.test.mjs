import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../script.js', import.meta.url), 'utf8');
test('invitation scene initializes before state and does not revive deleted live dance floors', () => {
  const functions = ['createHallObjects', 'hydrateHallObjects'].map(name => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`, 'm'))?.[0]);
  assert.ok(functions.every(Boolean));
  const scene = runInNewContext(functions.join('\n') + '\n({initial:hydrateHallObjects(), live:hydrateHallObjects([], true), saved:hydrateHallObjects([{id:"custom",type:"dance-floor",label:"Synthetic saved floor"}], true)})');
  assert.equal(scene.initial.some(item => item.type === 'dance-floor'), true);
  assert.equal(scene.live.some(item => item.type === 'dance-floor'), false);
  assert.equal(scene.saved.filter(item => item.type === 'dance-floor').length, 1);
  assert.equal(scene.saved.find(item => item.type === 'dance-floor').id, 'custom');
});
