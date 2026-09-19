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

  assert.deepEqual(queries, ['Learn practical AI agents', 'AI Engineering', 'computer vision tutorials']);
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