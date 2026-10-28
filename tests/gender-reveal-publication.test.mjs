import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as api from 'firebase/firestore';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { ensureGenderRevealPublished } from '../gender-reveal-publication.js';

test('gender reveal publication creates and synchronizes public details safely', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const env = await initializeTestEnvironment({ projectId: 'demo-reveal-publication', firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  const event = { ownerUserId: 'owner', eventCategory: 'gender_reveal', eventTitle: 'Synthetic Reveal', eventTitleAr: 'حفل الكشف عن جنس المولود', eventDateISO: '2027-05-20T15:30:00.000Z', eventTimeZone: 'Asia/Dubai', venueEn: '', status: 'active', seatingEnabled: false, showInvitationQr: false, genderRevealArtworkUrl: '/images/gender-reveal-cover.png', genderRevealOpeningVideoUrl: '/videos/gender-reveal-opening.mp4', genderRevealMusicUrl: '/music/gender-reveal-party.mp3' };
  try {
    await env.withSecurityRulesDisabled(async ctx => api.setDoc(api.doc(ctx.firestore(), 'weddings/test'), event));
    const owner = env.authenticatedContext('owner').firestore();
    assert.equal(await ensureGenderRevealPublished(api, owner, 'test'), true);
    const ref = api.doc(owner, 'weddings/test/publicEvent/details');
    const before = (await api.getDoc(ref)).data();
    assert.equal(before.eventTitle, 'Synthetic Reveal');
    assert.equal(before.genderRevealOpeningVideoUrl, '/videos/gender-reveal-opening.mp4');
    assert.equal(await ensureGenderRevealPublished(api, owner, 'test'), false);
    assert.deepEqual((await api.getDoc(ref)).data(), before);
    await env.withSecurityRulesDisabled(async ctx => api.updateDoc(api.doc(ctx.firestore(), 'weddings/test'), { status: 'draft' }));
    assert.equal(await ensureGenderRevealPublished(api, owner, 'test'), true);
    assert.equal((await api.getDoc(ref)).data().eventStatus, 'draft');
    const stranger = env.authenticatedContext('stranger').firestore();
    await assertFails(ensureGenderRevealPublished(api, stranger, 'test'));
  } finally { await env.cleanup(); }
});
