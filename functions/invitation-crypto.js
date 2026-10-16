"use strict";

const crypto = require("node:crypto");

const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVITATION_TOKEN_BYTES = 32;

function tokenHash(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function isValidInvitationToken(token) {
  if (typeof token !== "string" || !INVITATION_TOKEN_PATTERN.test(token)) return false;
  try {
    const bytes = Buffer.from(token, "base64url");
    return bytes.length === INVITATION_TOKEN_BYTES && bytes.toString("base64url") === token;
  } catch {
    return false;
  }
}

function randomInvitationToken() {
  return crypto.randomBytes(INVITATION_TOKEN_BYTES).toString("base64url");
}

function encryptInvitationToken(token, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

function decryptInvitationToken(value, key) {
  const payload = Buffer.from(value, "base64");
  if (payload.length < 29) throw new Error("Invalid invitation token ciphertext.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString("utf8");
}

module.exports = {
  decryptInvitationToken,
  encryptInvitationToken,
  isValidInvitationToken,
  randomInvitationToken,
  tokenHash,
};
