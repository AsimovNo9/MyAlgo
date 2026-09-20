import test from 'node:test';
import assert from 'node:assert/strict';

import { decryptOAuthToken, encryptOAuthToken } from './oauth-token-crypto.ts';

test('encrypts and decrypts OAuth tokens without storing plaintext', () => {
  const previousKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'test-oauth-token-key';

  try {
    const token = 'google-refresh-token-value';
    const encrypted = encryptOAuthToken(token);
    assert.match(encrypted, /^v1\./);
    assert.equal(encrypted.includes(token), false);
    assert.equal(decryptOAuthToken(encrypted), token);
  } finally {
    if (previousKey === undefined) delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    else process.env.OAUTH_TOKEN_ENCRYPTION_KEY = previousKey;
  }
});

test('rejects malformed or tampered OAuth tokens', () => {
  process.env.OAUTH_TOKEN_ENCRYPTION_KEY = 'test-oauth-token-key';
  try {
    assert.throws(() => decryptOAuthToken('plain-token'), /unsupported encryption format/i);
    const encrypted = encryptOAuthToken('token');
    assert.throws(() => decryptOAuthToken(`${encrypted}tampered`));
  } finally {
    delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  }
});