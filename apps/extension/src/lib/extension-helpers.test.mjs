import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeFeed } from './extension-helpers.ts';

test('summarizeFeed counts sources and ranks topics for visible items only', () => {
  const summary = summarizeFeed([
    { id: '1', external_id: '1', title: 'A', score: 90, visible: true, source_kind: 'subscription', matched_topics: ['AI', 'Engineering'] },
    { id: '2', external_id: '2', title: 'B', score: 80, visible: true, source_kind: 'discovery', matched_topics: ['AI'] },
    { id: '3', external_id: '3', title: 'C', score: 70, visible: true, source_kind: 'discovery', matched_topics: ['Gaming'] },
    { id: '4', external_id: '4', title: 'D', score: 10, visible: false, source_kind: 'discovery', matched_topics: ['Gossip'] },
  ]);

  assert.equal(summary.subscribedCount, 1);
  assert.equal(summary.discoveredCount, 2);
  assert.deepEqual(summary.topTopics, [
    { topic: 'AI', count: 2 },
    { topic: 'Engineering', count: 1 },
    { topic: 'Gaming', count: 1 },
  ]);
});

test('summarizeFeed handles an empty feed', () => {
  const summary = summarizeFeed([]);

  assert.equal(summary.subscribedCount, 0);
  assert.equal(summary.discoveredCount, 0);
  assert.deepEqual(summary.topTopics, []);
});
