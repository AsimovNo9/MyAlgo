import test from 'node:test';
import assert from 'node:assert/strict';

import { assembleCandidatePool } from './candidate-generation.ts';

test('RSS candidates contribute seeded topic coverage to the shared pool metrics', () => {
  const result = assembleCandidatePool([
    {
      source: 'youtube_rss',
      items: [
        {
          external_id: 'rss-1',
          topics: ['Nuclear Engineering'],
          provenance: { source: 'youtube_rss' },
          source_kind: 'discovery',
        },
        {
          external_id: 'rss-2',
          topics: ['Reactor Safety'],
          provenance: { source: 'youtube_rss' },
          source_kind: 'discovery',
        },
      ],
    },
  ], ['Nuclear Engineering', 'Reactor Safety']);

  assert.deepEqual(result.metrics.sourceCounts, {
    youtube_subscription: 0,
    youtube_search: 0,
    youtube_rss: 2,
  });
  assert.deepEqual(result.metrics.topicCoverage, {
    'nuclear engineering': 1,
    'reactor safety': 1,
  });
});