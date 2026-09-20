import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAlgorithmIntentProfile, normalizeSemanticContextEntry, resolveTopicConcepts, resolveTopicConceptTerms } from './concepts.ts';

test('resolveTopicConcepts expands gaming into canonical aliases and intents', () => {
  const resolved = resolveTopicConcepts('Gaming');

  assert.equal(resolved.canonical, 'Gaming');
  assert.equal(resolved.aliases.includes('game design'), true);
  assert.equal(resolved.aliases.includes('indie games'), true);
  assert.equal(resolved.intents.includes('gameplay systems'), true);
});

test('resolveTopicConceptTerms keeps canonical and goal-specific concept terms', () => {
  const terms = resolveTopicConceptTerms('Gaming', 'Build a deeper understanding of game design and gameplay systems');

  assert.equal(terms.includes('Gaming'), true);
  assert.equal(terms.includes('game design'), true);
  assert.equal(terms.includes('gameplay systems'), true);
  assert.equal(terms.includes('indie games'), true);
});

test('buildAlgorithmIntentProfile generalizes concept resolution beyond a single hardcoded topic', () => {
  const profile = buildAlgorithmIntentProfile({
    name: 'Creative Strategy',
    goal_text: 'Explore playful storytelling, mechanics, and game feel for indie experiences',
    topic_weights: [{ topic: 'Game Design', weight: 88 }],
    rules: [],
  });

  assert.equal(profile.canonicalTopics.includes('Game Design'), true);
  assert.equal(profile.aliases.includes('game design'), true);
  assert.equal(profile.aliases.includes('indie games'), true);
  assert.equal(profile.intents.some((intent) => intent.toLowerCase().includes('gameplay')), true);
  assert.equal(profile.semanticTerms.some((term) => term.toLowerCase().includes('gameplay')), true);
});

test('normalizeSemanticContextEntry produces a bounded pending, versioned import', () => {
  assert.deepEqual(normalizeSemanticContextEntry({
    canonicalName: 'Game Design',
    aliases: ['game design', 'game design'],
    entities: ['FromSoftware'],
    positivePhrases: ['combat systems'],
    negativePhrases: ['gacha spam'],
    source: 'llm',
    version: 3,
    provenance: { source_document: 'review-1' },
  }), {
    canonical_name: 'Game Design',
    aliases: ['game design'],
    intents: [],
    entities: ['FromSoftware'],
    positive_phrases: ['combat systems'],
    negative_phrases: ['gacha spam'],
    description: null,
    language: null,
    source: 'llm',
    status: 'pending',
    provenance: { source_document: 'review-1' },
    version: 3,
  });
  assert.equal(normalizeSemanticContextEntry({ canonical_name: '' }), null);
});
