import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRecommendationQualityMetrics } from './recommendation-quality.ts';

test('builds production-facing candidate quality metrics', () => {
  assert.deepEqual(buildRecommendationQualityMetrics({
    inputCount: 10,
    uniqueCount: 8,
    duplicateCount: 2,
    sourceCounts: { youtube_subscription: 4, youtube_search: 2, youtube_rss: 2, youtube_liked: 0 },
    topicCoverage: { gaming: 5 },
  }, 6, 4), {
    candidateCount: 10,
    uniqueCount: 8,
    duplicateRate: 0.2,
    classificationCoverage: 0.75,
    sourceDiversity: 3,
    topicCoverage: { gaming: 5 },
    freshnessCoverage: 0.5,
  });
});