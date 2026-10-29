import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordRecoveryUrl, shouldShowRecovery } from '../login-recovery.js';
test('customer password recovery is offered after two credential failures, not network errors', () => {
  let result = shouldShowRecovery(0, 'auth/invalid-credential');
  assert.deepEqual(result, { failures: 1, visible: false });
  result = shouldShowRecovery(result.failures, 'auth/network-request-failed');
  assert.deepEqual(result, { failures: 1, visible: false });
  result = shouldShowRecovery(result.failures, 'auth/wrong-password');
  assert.deepEqual(result, { failures: 2, visible: true });
  assert.equal(shouldShowRecovery(0, 'auth/too-many-requests').visible, true);
});

test('WhatsApp recovery includes the entered email without including a password', () => {
  const url = new URL(passwordRecoveryUrl('  customer+event@example.test  '));
  assert.equal(url.origin + url.pathname, 'https://wa.me/971504611123');
  assert.equal(url.searchParams.get('text'), "I'm having issue with this account. Can you please reset my password?\n\nAccount email: customer+event@example.test");
});
