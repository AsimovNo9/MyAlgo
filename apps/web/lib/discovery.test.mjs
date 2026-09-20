import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDiscoveryQueries, buildDiscoveryQueryPlans, discoveryLimits } from './discovery.ts';

test('buildDiscoveryQueryPlans preserves query lane, topics, and algorithm revision', () => {
  const plans = buildDiscoveryQueryPlans({
    id: 'algorithm-gaming',
    name: 'Gaming',
    goal_text: 'Nintendo RPG analysis',
    topic_weights: [{ topic: 'Gaming', weight: 90 }],
    rules: [],
  });

  assert.equal(plans[0].algorithmRevision, 'algorithm-gaming');
  assert.equal(plans[0].lane, 'goal');
  assert.deepEqual(plans[0].topics, ['Gaming']);
});

test('buildDiscoveryQueryPlans expands strong topics through approved graph relations', () => {
  const plans = buildDiscoveryQueryPlans(
    { id: 'alg-graph', name: 'Gaming', topic_weights: [{ topic: 'Gaming', weight: 90 }], rules: [] },
    [
      { id: 'gaming', canonicalName: 'Gaming', aliases: [], intents: [] },
      { id: 'rpg', canonicalName: 'Role-playing games', aliases: ['RPG'], intents: [] },
    ],
    [{ source_concept_id: 'gaming', target_concept_id: 'rpg', relation_type: 'child_of', weight: 0.9 }],
  );

  assert.ok(plans.some((plan) => plan.lane === 'intent' && /Role-playing games/i.test(plan.text)));
});

test('buildDiscoveryQueries derives one query per strong topic alongside the goal', () => {
  const queries = buildDiscoveryQueries({
    name: 'Work',
    goal_text: 'Learn practical AI agents',
    topic_weights: [
      { topic: 'AI', weight: 90 },
      { topic: 'Engineering', weight: 80 },
      { topic: 'Entertainment', weight: 20 },
    ],
    rules: [{ type: 'priority', condition_text: 'computer vision tutorials' }],
  });

  assert.deepEqual(queries, [
    'Learn practical AI agents',
    'AI tutorial',
    'Engineering tutorial',
    'AI latest',
    'Engineering latest',
  ]);
  assert.equal(queries.length <= discoveryLimits.maxQueriesPerSync, true);
});

test('buildDiscoveryQueries omits weak and never-show signals', () => {
  const queries = buildDiscoveryQueries({
    name: 'Relax',
    goal_text: null,
    topic_weights: [{ topic: 'Entertainment', weight: 40 }],
    rules: [{ type: 'never_show', condition_text: 'celebrity gossip' }],
  });

  assert.deepEqual(queries, []);
});

test('buildDiscoveryQueries creates a format-aware query for a learning topic', () => {
  const queries = buildDiscoveryQueries({
    name: 'Computer Vision',
    goal_text: 'Learn computer vision from university-level material',
    topic_weights: [{ topic: 'Computer Vision', weight: 95 }],
    rules: [],
  });

  assert.deepEqual(queries, [
    'Learn computer vision from university-level material',
    'Computer Vision tutorial',
    'Computer Vision latest',
  ]);
});

test('buildDiscoveryQueries expands concept aliases for arbitrary user-defined topics', () => {
  const queries = buildDiscoveryQueries({
    name: 'Gaming',
    goal_text: 'Build a deeper understanding of game design and gameplay systems',
    topic_weights: [{ topic: 'Gaming', weight: 93 }],
    rules: [{ type: 'priority', condition_text: 'indie games' }],
  });

  assert.equal(queries[0], 'Build a deeper understanding of game design and gameplay systems');
  assert.equal(queries.includes('game design'), true);
  assert.equal(queries.includes('indie games'), true);
  assert.equal(queries.length <= discoveryLimits.maxQueriesPerSync, true);
});

test('buildDiscoveryQueries discovers content from every strong topic in a multi-topic algorithm', () => {
  const queries = buildDiscoveryQueries({
    name: 'Computer Vision Mix',
    goal_text: '',
    topic_weights: [
      { topic: 'Computer Vision', weight: 90 },
      { topic: 'AI', weight: 85 },
      { topic: 'Gaming', weight: 70 },
      { topic: 'Work', weight: 60 },
    ],
    rules: [{ type: 'never_show', condition_text: 'celebrity gossip' }],
  });

  assert.equal(queries.includes('Computer Vision guide'), true);
  assert.equal(queries.includes('AI guide'), true);
  assert.equal(queries.some((query) => query.toLowerCase().includes('gam')), true);
  assert.equal(queries.length <= discoveryLimits.maxQueriesPerSync, true);
});