import assert from 'node:assert/strict';
import test from 'node:test';
import { photoBucketReturn, loginWithReturn, autoOpenTarget } from '../photo-bucket/return-link.js';

const base = 'https://events.example.com/dashboard-login.html?next=x';
test('accepts only the photo bucket manage page on this site', () => {
  assert.equal(photoBucketReturn('photo-bucket-manage.html?bucket=photo-event-1', base), './photo-bucket-manage.html?bucket=photo-event-1');
  assert.equal(photoBucketReturn('/photo-bucket-manage.html?bucket=abc_123', base), './photo-bucket-manage.html?bucket=abc_123');
  assert.equal(photoBucketReturn('https://events.example.com/photo-bucket-manage.html?bucket=x', base), './photo-bucket-manage.html?bucket=x');
});
test('rejects other sites, other pages and bad ids', () => {
  for (const bad of ['https://evil.com/photo-bucket-manage.html?bucket=x', '//evil.com/photo-bucket-manage.html?bucket=x', 'javascript:alert(1)',
    'all-events.html', 'dashboard.html?wedding=1', 'photo-bucket-manage.html', 'photo-bucket-manage.html?bucket=a/../b', 'photo-bucket-manage.html?bucket=' + 'a'.repeat(81), '', null, undefined])
    assert.equal(photoBucketReturn(bad, base), '', String(bad));
});
test('login redirect keeps only the page name and query', () => {
  assert.equal(loginWithReturn({ pathname: '/photo-bucket-manage.html', search: '?bucket=photo-event-1' }), './dashboard-login.html?message=session-required&next=photo-bucket-manage.html%3Fbucket%3Dphoto-event-1');
});

test('a customer with exactly one photo bucket opens it directly, once', () => {
  const one = [{ id: 'photo-event-1' }];
  assert.equal(autoOpenTarget({ customer: true, buckets: one, seen: false }), './photo-bucket-manage.html?bucket=photo-event-1');
  assert.equal(autoOpenTarget({ customer: true, buckets: one, seen: true }), '');
  assert.equal(autoOpenTarget({ customer: false, buckets: one, seen: false }), '');
  assert.equal(autoOpenTarget({ customer: true, buckets: [], seen: false }), '');
  assert.equal(autoOpenTarget({ customer: true, buckets: [...one, { id: 'b' }], seen: false }), '');
  assert.equal(autoOpenTarget({ customer: true, buckets: [{ id: '../x' }], seen: false }), '');
});
