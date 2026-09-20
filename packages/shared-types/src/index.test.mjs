import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampSemanticConfidence,
  normalizeSemanticConceptMatch,
  normalizeSemanticKey,
  normalizeSemanticList,
} from './index.ts';

test('normalizes semantic keys and deduplicates semantic lists', () => {
  assert.equal(normalizeSemanticKey('  Game-Design!  '), 'game design');
  assert.deepEqual(normalizeSemanticList(['RPG', ' rpg ', '', 'Game Design']), ['rpg', 'game design']);
});

test('bounds semantic confidence and similarity values', () => {
  assert.equal(clampSemanticConfidence(2), 1);
  assert.equal(clampSemanticConfidence(-1), 0);
  assert.equal(clampSemanticConfidence(Number.NaN), 0);
  assert.deepEqual(normalizeSemanticConceptMatch({
    concept_id: ' RPG ',
    confidence: 1.4,
    similarity: -0.2,
    source: 'embedding',
  }), {
    concept_id: 'rpg',
    confidence: 1,
    similarity: 0,
    source: 'embedding',
  });
});