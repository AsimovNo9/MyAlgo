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

test('buildRecommendationProfile creates explicit creator query terms', () => {
  const profile = buildRecommendationProfile({
    name: 'Gaming',
    topic_weights: [{ topic: 'Gaming', weight: 90 }],
    rules: [
      { type: 'priority', condition_text: 'creator: Digital Foundry' },
      { type: 'priority', condition_text: 'channel: Digital Foundry' },
    ],
  });

  assert.deepEqual(profile.creatorTerms, ['Digital Foundry']);
  assert.equal(buildRecommendationQueries(profile, 5).some((query) => query.lane === 'creator' && /Digital Foundry/i.test(query.text)), true);
});

test('buildRecommendationProfile keeps a recognized algorithm name as a retrieval topic', () => {
  const profile = buildRecommendationProfile({
    name: 'Gaming',
    goal_text: 'Learn about the latest games',
    topic_weights: [
      { topic: 'Forza', weight: 20 },
      { topic: 'Elden Ring', weight: 50 },
      { topic: 'Game news', weight: 50 },
    ],
    rules: [],
  });

  assert.deepEqual(profile.explicitTopics, ['Elden Ring', 'Game news', 'Gaming']);
  assert.equal(buildRecommendationQueries(profile, 5).some((query) => query.topics.includes('Gaming')), true);
});

test('buildRecommendationQueries expands aliases for arbitrary catalog concepts', () => {
  const profile = buildRecommendationProfile({
    name: 'Science',
    topic_weights: [{ topic: 'Quantum computing', weight: 90 }],
    rules: [],
  }, [{
    id: 'quantum',
    canonicalName: 'Quantum computing',
    aliases: ['quantum information', 'quantum algorithms'],
    intents: ['qubit systems', 'quantum error correction'],
  }]);

  const queries = buildRecommendationQueries(profile, 10, [{
    canonicalName: 'Quantum computing',
    aliases: ['quantum information', 'quantum algorithms'],
    intents: ['qubit systems', 'quantum error correction'],
  }]);

  assert.equal(queries.some((query) => /quantum information|quantum algorithms/i.test(query.text)), true);
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

  assert.equal(queries[0].text, 'Nintendo RPGs');
  assert.equal(queries.some((query) => query.text === 'Gaming guide'), true);
  assert.equal(queries.some((query) => query.text === 'Engineering guide'), true);
  assert.equal(queries.some((query) => query.text === 'RPG guide'), true);
  assert.equal(new Set(queries.map((query) => query.text.toLowerCase())).size, queries.length);
});