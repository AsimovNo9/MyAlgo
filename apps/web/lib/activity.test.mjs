import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeActivityRequest } from './activity.ts';

test('normalizeActivityRequest accepts bounded activity events', () => {
  assert.deepEqual(normalizeActivityRequest({
    externalId: 'video-1',
    eventType: 'watch_progress',
    watchSeconds: 42.6,
    occurredAt: '2026-09-20T10:00:00Z',
  }), {
    externalId: 'video-1',
    eventType: 'watch_progress',
    watchSeconds: 43,
    occurredAt: '2026-09-20T10:00:00.000Z',
  });
});

test('normalizeActivityRequest rejects invalid event types and excessive durations', () => {
  assert.throws(() => normalizeActivityRequest({ externalId: 'video-1', eventType: 'hover' }), /Invalid activity/);
  assert.throws(() => normalizeActivityRequest({ externalId: 'video-1', eventType: 'opened', watchSeconds: 86401 }), /duration/);
  assert.throws(() => normalizeActivityRequest({ externalId: 'video-1', eventType: 'opened', occurredAt: 'invalid' }), /timestamp/);
});