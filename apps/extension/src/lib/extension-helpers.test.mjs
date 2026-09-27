import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInferredModeOptions, summarizeFeed } from './extension-helpers.ts';

test('summarizeFeed counts sources and ranks topics for visible items only', () => {
  const summary = summarizeFeed([
    { id: '1', external_id: '1', title: 'A', score: 90, visible: true, source_kind: 'subscription', matched_topics: ['AI', 'Engineering'], semantic_category: 'learning', semantic_category_confidence: 0.7 },
    { id: '2', external_id: '2', title: 'B', score: 80, visible: true, source_kind: 'discovery', matched_topics: ['AI'], semantic_category: 'learning', semantic_category_confidence: 0.6 },
    { id: '3', external_id: '3', title: 'C', score: 70, visible: true, source_kind: 'discovery', matched_topics: ['Gaming'], semantic_category: 'gaming', semantic_category_confidence: 0.4 },
    { id: '4', external_id: '4', title: 'D', score: 10, visible: false, source_kind: 'discovery', matched_topics: ['Gossip'] },
  ]);

  assert.equal(summary.subscribedCount, 1);
  assert.equal(summary.discoveredCount, 2);
  assert.deepEqual(summary.topTopics, [
    { topic: 'AI', count: 2 },
    { topic: 'Engineering', count: 1 },
    { topic: 'Gaming', count: 1 },
  ]);
  assert.deepEqual(summary.categories, [{ category: 'learning', count: 2 }, { category: 'gaming', count: 1 }]);
});

test('summarizeFeed handles an empty feed', () => {
  const summary = summarizeFeed([]);

  assert.equal(summary.subscribedCount, 0);
  assert.equal(summary.discoveredCount, 0);
  assert.deepEqual(summary.topTopics, []);
  assert.deepEqual(summary.categories, []);
});


test('buildInferredModeOptions uses inferred categories instead of a fixed taxonomy', () => {
  assert.deepEqual(
    buildInferredModeOptions('Default', [
      { category: 'Distributed systems', count: 4 },
      { category: 'Ambient music', count: 2 },
    ]),
    ['Default', 'Distributed systems', 'Ambient music'],
  );
  assert.deepEqual(
    buildInferredModeOptions('Legacy Work', [{ category: 'Distributed systems', count: 4 }]),
    ['Default', 'Distributed systems', 'Legacy Work'],
  );
});


test('summarizeFeed discovers recurring mode categories from soft semantic scores without forcing badges', () => {
  const summary = summarizeFeed([
    {
      id: '1', external_id: '1', title: 'A', score: 80, visible: true,
      semantic_category: null, semantic_category_confidence: 0,
      semantic_category_scores: { 'AI tooling': 0.44, 'Web development': 0.31 },
    },
    {
      id: '2', external_id: '2', title: 'B', score: 78, visible: true,
      semantic_category: null, semantic_category_confidence: 0,
      semantic_category_scores: { 'AI tooling': 0.49, 'Personal finance': 0.28 },
    },
    {
      id: '3', external_id: '3', title: 'C', score: 74, visible: true,
      semantic_category: null, semantic_category_confidence: 0,
      semantic_category_scores: { 'Personal finance': 0.45, 'AI tooling': 0.26 },
    },
  ]);

  assert.deepEqual(summary.categories, [
    { category: 'AI tooling', count: 3 },
    { category: 'Personal finance', count: 2 },
  ]);
  assert.deepEqual(
    buildInferredModeOptions('Default', summary.categories),
    ['Default', 'AI tooling', 'Personal finance'],
  );
});
