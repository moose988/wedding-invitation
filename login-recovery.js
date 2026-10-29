export function shouldShowRecovery(failures, errorCode) {
  const credentialErrors = new Set(['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password', 'auth/user-not-found']);
  const nextFailures = failures + (credentialErrors.has(errorCode) ? 1 : 0);
  return { failures: nextFailures, visible: nextFailures >= 2 || errorCode === 'auth/too-many-requests' };
}

export function passwordRecoveryUrl(email) {
  const message = "I'm having issue with this account. Can you please reset my password?";
  const account = String(email || '').trim();
  const text = account ? `${message}\n\nAccount email: ${account}` : message;
  return `https://wa.me/971504611123?text=${encodeURIComponent(text)}`;
}
