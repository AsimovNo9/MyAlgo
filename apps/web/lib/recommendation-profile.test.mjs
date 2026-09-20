import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRecommendationProfile, buildRecommendationQueries } from './recommendation-profile.ts';

test('buildRecommendationProfile separates positive and negative rules', () => {
  const profile = buildRecommendationProfile({
    name: 'Gaming',
    goal_text: 'Learn Nintendo RPG design',
    topic_weights: [{ topic: 'Gaming', weight: 90 }, { topic: 'RPG', weight: 80 }, { topic: 'News', weight: 20 }],
    rules: [
      { type: 'priority', condition_text: 'developer commentary' },
      { type: 'never_show', condition_text: 'celebrity gossip' },
    ],
  });

  assert.deepEqual(profile.explicitTopics, ['Gaming', 'RPG']);
  assert.deepEqual(profile.positiveRuleTerms, ['developer commentary']);
  assert.deepEqual(profile.negativeRuleTerms, ['celebrity gossip']);
  assert.deepEqual(profile.preferredFormats, ['tutorial']);
  assert.equal(profile.semanticTerms.includes('game design'), true);
});

test('buildRecommendationQueries is bounded, round-robin, and deduplicated', () => {
  const profile = buildRecommendationProfile({
    name: 'Gaming',
    goal_text: 'Nintendo RPGs',
    topic_weights: [
      { topic: 'Gaming', weight: 90 },
      { topic: 'Engineering', weight: 85 },
      { topic: 'RPG', weight: 80 },
    ],
    rules: [],
  });

  const queries = buildRecommendationQueries(profile, 4);

  assert.deepEqual(queries.map((query) => query.text), [
    'Nintendo RPGs',
    'game design',
    'Engineering guide',
    'RPG guide',
  ]);
  assert.deepEqual(queries.map((query) => query.lane), ['goal', 'alias', 'format', 'format']);
  assert.equal(new Set(queries.map((query) => query.text.toLowerCase())).size, queries.length);
});

test('buildRecommendationQueries adds intent and freshness lanes after core topic queries', () => {
  const profile = buildRecommendationProfile({
    name: 'Gaming',
    goal_text: 'Learn game design systems',
    topic_weights: [{ topic: 'Gaming', weight: 90 }],
    rules: [],
  });

  const queries = buildRecommendationQueries(profile, 20);

  assert.equal(queries.some((query) => query.lane === 'intent' && query.text.includes('game design')), true);
  assert.equal(queries.some((query) => query.lane === 'freshness' && query.text === 'Gaming latest tutorial'), true);
  assert.equal(queries.length <= 20, true);
});