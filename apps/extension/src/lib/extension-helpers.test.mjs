import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDurableModeOptions, summarizeFeed } from './extension-helpers.ts';

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


test('buildDurableModeOptions uses persisted stable mode IDs instead of feed categories', () => {
  const catalog = {
    pipelineId: 'durable-semantic-mode-cluster-v1',
    graphRevision: 12,
    generatedAt: '2026-09-27T20:00:00.000Z',
    modes: [
      {
        id: 'mode:inferred:v1:systems',
        label: 'Distributed systems',
        revision: 3,
        members: [],
        provenance: 'inferred',
        pipelineId: 'durable-semantic-mode-cluster-v1',
        graphRevision: 12,
        createdAt: '2026-09-27T19:00:00.000Z',
        lastSupportedAt: '2026-09-27T20:00:00.000Z',
        active: true,
        pinned: false,
      },
      {
        id: 'mode:inferred:v1:ambient',
        label: 'Ambient music',
        revision: 2,
        members: [],
        provenance: 'inferred',
        pipelineId: 'durable-semantic-mode-cluster-v1',
        graphRevision: 12,
        createdAt: '2026-09-27T18:00:00.000Z',
        lastSupportedAt: '2026-09-27T19:30:00.000Z',
        active: false,
        pinned: false,
      },
    ],
  };

  assert.deepEqual(
    buildDurableModeOptions('default', catalog),
    [
      { id: 'default', label: 'All', revision: null, active: true },
      { id: 'mode:inferred:v1:systems', label: 'Distributed systems', revision: 3, active: true },
    ],
  );

  assert.deepEqual(
    buildDurableModeOptions('mode:inferred:v1:ambient', catalog),
    [
      { id: 'default', label: 'All', revision: null, active: true },
      { id: 'mode:inferred:v1:systems', label: 'Distributed systems', revision: 3, active: true },
      { id: 'mode:inferred:v1:ambient', label: 'Ambient music', revision: 2, active: false },
    ],
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
});
