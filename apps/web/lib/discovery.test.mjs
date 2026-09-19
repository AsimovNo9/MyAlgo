import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDiscoveryQueries, discoveryLimits } from './discovery.ts';

test('buildDiscoveryQueries derives bounded queries from goals, weights, and rules', () => {
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
    'AI Engineering',
    'AI tutorial',
    'AI lecture',
    'AI university course',
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

test('buildDiscoveryQueries creates format-aware queries for a learning topic', () => {
  const queries = buildDiscoveryQueries({
    name: 'Computer Vision',
    goal_text: 'Learn computer vision from university-level material',
    topic_weights: [{ topic: 'Computer Vision', weight: 95 }],
    rules: [],
  });

  assert.deepEqual(queries, [
    'Learn computer vision from university-level material',
    'Computer Vision',
    'Computer Vision tutorial',
    'Computer Vision lecture',
    'Computer Vision university course',
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
  assert.equal(queries.includes('Gaming'), true);
  assert.equal(queries.includes('game design'), true);
  assert.equal(queries.includes('game development'), true);
  assert.equal(queries.includes('indie games'), true);
  assert.equal(queries.length <= discoveryLimits.maxQueriesPerSync, true);
});