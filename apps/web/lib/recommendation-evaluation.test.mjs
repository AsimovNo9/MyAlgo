import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRecommendation, recommendationEvaluationFixtures } from './recommendation-evaluation.ts';

test('evaluation fixtures cover the required recommendation failure modes', () => {
  assert.deepEqual(
    [...new Set(recommendationEvaluationFixtures.map((fixture) => fixture.kind))].sort(),
    ['adjacent', 'ambiguous', 'direct', 'duplicate', 'language', 'negative', 'replacement', 'watched'],
  );
});

test('evaluation metrics measure relevance, coverage, novelty, diversity, replacement, and correction', () => {
  const metrics = evaluateRecommendation({
    candidates: recommendationEvaluationFixtures,
    rankedIds: ['direct-rpg', 'adjacent-design', 'replacement-rpg', 'ambiguous-review', 'duplicate-rpg'],
    expectedConceptIds: ['rpg', 'game-design'],
    excludedIds: ['negative-gacha', 'watched-rpg', 'language-ja'],
    rejectedNativeSlots: 2,
    replacementIds: ['replacement-rpg', 'adjacent-design'],
    correctionIds: ['negative-gacha', 'watched-rpg'],
  }, 5);

  assert.equal(metrics.relevantAtK, 0.8);
  assert.equal(metrics.falsePositiveRate, 0.2);
  assert.equal(metrics.conceptCoverage, 1);
  assert.equal(metrics.novelty, 0.8);
  assert.equal(metrics.diversity, 0.8);
  assert.equal(metrics.replacementSuccess, 1);
  assert.equal(metrics.correctionRate, 1);
});