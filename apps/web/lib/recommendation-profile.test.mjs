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

test('buildRecommendationProfile prefers explicit language and formats over inferred defaults', () => {
  const profile = buildRecommendationProfile({
    name: 'Gaming',
    goal_text: 'Learn Nintendo RPG design',
    language: ' EN ',
    preferred_formats: ['Review', 'long-form', 'Review'],
    topic_weights: [{ topic: 'Gaming', weight: 90 }],
    rules: [],
  });

  assert.equal(profile.language, 'en');
  assert.deepEqual(profile.preferredFormats, ['review', 'long-form']);
  const queryTexts = buildRecommendationQueries(profile, 20).map((query) => query.text);
  assert.equal(queryTexts.includes('Gaming review'), true);
  assert.equal(queryTexts.includes('Gaming long-form'), true);
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