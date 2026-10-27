import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { details, guestUrl, readGuestUrl } from '../photo-bucket/links.js';
import { validateFile, LIMITS } from '../photo-bucket/limits.js';
import { cropRect } from '../photo-bucket/images.js';
import { makeZip } from '../photo-bucket/zip.js';
test('public link round trip contains only versioned public details and a stable ID', () => {
  const b = { id:'bucket-123', name:'Layla & Zaid 🌸', date:'2027-04-18', location:'The Glasshouse, Dubai', ownerId:'private-user', token:'secret', photos:['private'] };
  const url = guestUrl(b, 'http://localhost:5173/all-events.html');
  assert.deepEqual(readGuestUrl(url), { id:b.id, ...details(b) });
  assert.ok(!decodeURIComponent(url).includes('private')); assert.ok(!url.includes('secret'));
  assert.equal(new URL(guestUrl({ ...b, name:'New name' }, 'https://example.test/all-events.html')).searchParams.get('bucket'), b.id);
  assert.equal(new URL(guestUrl(b, 'http://localhost/', 'https://photos.example.test')).origin, 'https://photos.example.test');
  assert.throws(() => guestUrl(b, 'http://localhost/', 'javascript:alert(1)'));
});
test('URL and event validation reject invalid IDs, missing fields, versions and impossible dates', () => {
  assert.throws(() => details({ name:'x', location:'y', date:'2027-02-30' }));
  assert.throws(() => details({ name:'', location:'y', date:'2027-02-28' }));
  assert.throws(() => readGuestUrl('https://example.test/?bucket=../x#event=%7B%7D'));
  assert.throws(() => readGuestUrl('https://example.test/?bucket=a#event=%7B%22v%22:2%7D'));
  assert.throws(() => readGuestUrl('https://example.test/?bucket=a#event=%ZZ'));
});
test('central limits reject unsupported, empty and oversized files', () => {
  assert.doesNotThrow(() => validateFile({ type:'image/jpeg', size:100 }));
  assert.throws(() => validateFile({ type:'image/heic', size:100 }), /HEIC/);
  assert.throws(() => validateFile({ type:'image/jpeg', size:0 }), /empty/);
  assert.throws(() => validateFile({ type:'image/png', size:LIMITS.fileBytes+1 }), /20 MB/);
});
test('crop coordinates use the rotated image dimensions and clamp within bounds', () => {
  assert.deepEqual(cropRect(600,1000,{ size:50,x:100,y:0 }), { x:300,y:0,width:300,height:500 });
  assert.deepEqual(cropRect(1000,600,{ size:50,x:0,y:100 }), { x:0,y:300,width:500,height:300 });
  assert.deepEqual(cropRect(10,10,{ size:500,x:200,y:-100 }), { x:0,y:0,width:10,height:10 });
});
test('ZIP contains real stored bytes, a central directory, and bounded size', async () => {
  const data = new TextEncoder().encode('real-photo-bytes'); const photo = { id:'one', size:data.length };
  const zip = await makeZip([photo], async () => new Blob([data])); const bytes = new Uint8Array(await zip.arrayBuffer()); const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0,true),0x04034b50); assert.equal(view.getUint16(8,true),0);
  assert.equal(view.getUint32(bytes.length-22,true),0x06054b50); assert.equal(view.getUint16(bytes.length-12,true),1);
  assert.match(new TextDecoder().decode(bytes),/real-photo-bytes/);
  await assert.rejects(() => makeZip([{ id:'big',size:LIMITS.zipBytes+1 }], () => {}),/too large/);
});
test('Photo Bucket is third and its branch exits before all legacy backend writes', async () => {
  for (const page of ['all-events.html','customer-events.html']) {
    const html = await readFile(new URL('../'+page,import.meta.url),'utf8');
    const categories = [...html.matchAll(/name="eventCategory" value="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(categories, ['wedding_engagement','celebration','photo_bucket','gender_reveal']);
  }
  const source = await readFile(new URL('../weddings.js',import.meta.url),'utf8');
  const branch = source.slice(source.indexOf('async function saveWedding'),source.indexOf('if (!state.isAdmin) return;',source.indexOf('async function saveWedding')));
  assert.match(branch,/createOwnerAdapter\(state.user\)\)\.create/); assert.match(branch,/return;\s*}\s*$/);
  assert.doesNotMatch(branch,/writeBatch|setDoc|updateDoc|serverTimestamp/);
});
test('local modules do not send data to a backend and guest entry never imports Auth', async () => {
  for (const name of ['adapter','images','transport','zip','links']) {
    const source = await readFile(new URL(`../photo-bucket/${name}.js`,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|firebase-config|firebase-storage|firebase-firestore/);
  }
  const app = await readFile(new URL('../photo-bucket/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(app,/indexedDB|\.transaction\(/);
  assert.match(app,/if \(owner\) \{\s*const \{ requireOwnerSession \} = await import/);
});
