import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const {
  decryptInvitationToken,
  encryptInvitationToken,
  isValidInvitationToken,
  randomInvitationToken,
  tokenHash,
} = require("../functions/invitation-crypto.js");

test("invitation capabilities are independent 256-bit canonical base64url values", () => {
  const first = randomInvitationToken();
  const second = randomInvitationToken();
  assert.equal(first.length, 43);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(isValidInvitationToken(first), true);
  assert.notEqual(first, second);
  assert.equal(Buffer.from(first, "base64url").length, 32);
});

test("legacy, malformed, truncated, and non-canonical credentials fail validation", () => {
  for (const value of [null, 1, "", "demo-token-1", "A".repeat(42), "A".repeat(44), "_".repeat(43) + "."]) {
    assert.equal(isValidInvitationToken(value), false, String(value));
  }
});

test("lookup stores only a SHA-256 digest and ciphertext is authenticated", () => {
  const token = randomInvitationToken();
  const key = createHash("sha256").update("test-managed-secret", "utf8").digest();
  const digest = tokenHash(token);
  const ciphertext = encryptInvitationToken(token, key);
  assert.equal(digest, createHash("sha256").update(token, "utf8").digest("hex"));
  assert.equal(digest.includes(token), false);
  assert.notEqual(ciphertext, token);
  assert.equal(decryptInvitationToken(ciphertext, key), token);
  assert.throws(() => decryptInvitationToken(ciphertext, createHash("sha256").update("wrong-secret").digest()));
});
