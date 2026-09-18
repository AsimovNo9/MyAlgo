import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeFeedbackRequest } from './feedback.ts';

test('normalizeFeedbackRequest trims values and accepts valid feedback types', () => {
  const result = normalizeFeedbackRequest({
    contentItemId: '  yt-123  ',
    eventType: 'more_like_this',
  });

  assert.equal(result.contentItemId, 'yt-123');
  assert.equal(result.eventType, 'more_like_this');
});

test('normalizeFeedbackRequest rejects invalid event types', () => {
  assert.throws(() => {
    normalizeFeedbackRequest({
      contentItemId: 'yt-999',
      eventType: 'invalid_event' as any,
    });
  }, /Invalid feedback event type/);
});
