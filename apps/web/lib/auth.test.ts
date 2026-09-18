import test from 'node:test';
import assert from 'node:assert/strict';

import { getUserIdFromSession } from './auth.ts';

test('getUserIdFromSession returns the auth user id when present', () => {
  const session = {
    user: {
      id: 'user-123',
      email: 'demo@example.com',
    },
  } as any;

  assert.equal(getUserIdFromSession(session), 'user-123');
});

test('getUserIdFromSession returns null when no active session exists', () => {
  assert.equal(getUserIdFromSession(null), null);
  assert.equal(getUserIdFromSession(undefined), null);
});
