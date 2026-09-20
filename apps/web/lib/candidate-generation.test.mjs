import test from 'node:test';
import assert from 'node:assert/strict';

import { assembleCandidatePool } from './candidate-generation.ts';
import { getTopicCoverage, hasSufficientTopicCoverage } from './candidates.ts';

test('assembleCandidatePool deduplicates sources while preserving first-seen candidates', () => {
  const result = assembleCandidatePool([
    {
      source: 'youtube_subscription',
      items: [
        { external_id: 'shared', topics: ['Gaming'], source_kind: 'subscription' },
        { external_id: 'subscription-only', topics: ['RPG'], source_kind: 'subscription' },
      ],
    },
    {
      source: 'youtube_search',
      items: [
        { external_id: 'shared', topics: ['Gaming'], source_kind: 'discovery' },
        { external_id: 'search-only', topics: ['Gaming'], source_kind: 'discovery' },
      ],
    },
  ], ['Gaming', 'RPG']);

  assert.deepEqual(result.items.map((item) => item.external_id), ['shared', 'subscription-only', 'search-only']);
  assert.equal(result.metrics.inputCount, 4);
  assert.equal(result.metrics.uniqueCount, 3);
  assert.equal(result.metrics.duplicateCount, 1);
  assert.deepEqual(result.metrics.sourceCounts, {
    youtube_subscription: 2,
    youtube_search: 2,
    youtube_rss: 0,
    youtube_liked: 0,
  });
  assert.deepEqual(result.metrics.topicCoverage, { gaming: 2, rpg: 1 });
});

test('assembleCandidatePool uses provenance source when available', () => {
  const result = assembleCandidatePool([
    {
      source: 'youtube_subscription',
      items: [{ external_id: 'rss-item', provenance: { source: 'youtube_rss' } }],
    },
  ]);

  assert.equal(result.metrics.sourceCounts.youtube_subscription, 0);
  assert.equal(result.metrics.sourceCounts.youtube_rss, 1);
});

test('topic coverage requires each strong interest, not only a global match total', () => {
  const rows = [
    { classifications: { topics: ['Gaming', 'Elden Ring'] } },
    { classifications: { topics: ['Gaming'] } },
    { classifications: { topics: ['Gaming'] } },
    { classifications: { topics: ['Gaming'] } },
    { classifications: { topics: ['Gaming'] } },
  ];

  assert.deepEqual(getTopicCoverage(rows, ['Gaming', 'Elden Ring']), { gaming: 5, 'elden ring': 1 });
  assert.equal(hasSufficientTopicCoverage(rows, ['Gaming', 'Elden Ring'], 2), false);
  assert.equal(hasSufficientTopicCoverage([...rows, ...rows], ['Gaming', 'Elden Ring'], 2), true);
});