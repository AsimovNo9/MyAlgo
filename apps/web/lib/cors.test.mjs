import test from 'node:test';
import assert from 'node:assert/strict';

import { applyCorsHeaders, isAllowedOrigin } from './cors.ts';

test('CORS allows configured site and extension origins', () => {
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'chrome-extension://test-extension';

  try {
    assert.equal(isAllowedOrigin('http://localhost:3000'), true);
    assert.equal(isAllowedOrigin('chrome-extension://test-extension'), true);
    assert.equal(isAllowedOrigin('https://untrusted.example'), false);
  } finally {
    if (previous === undefined) {
      delete process.env.CORS_ALLOWED_ORIGINS;
    } else {
      process.env.CORS_ALLOWED_ORIGINS = previous;
    }
  }
});

test('CORS headers are only applied to allowed origins', () => {
  const previous = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = 'chrome-extension://test-extension';

  try {
    const allowedHeaders = new Headers();
    applyCorsHeaders(allowedHeaders, 'chrome-extension://test-extension');
    assert.equal(allowedHeaders.get('Access-Control-Allow-Origin'), 'chrome-extension://test-extension');
    assert.equal(allowedHeaders.get('Access-Control-Allow-Credentials'), 'true');

    const blockedHeaders = new Headers();
    applyCorsHeaders(blockedHeaders, 'https://untrusted.example');
    assert.equal(blockedHeaders.get('Access-Control-Allow-Origin'), null);
  } finally {
    if (previous === undefined) {
      delete process.env.CORS_ALLOWED_ORIGINS;
    } else {
      process.env.CORS_ALLOWED_ORIGINS = previous;
    }
  }
});
