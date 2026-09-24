import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRetrievalCoordinatorPlan } from '../src/index.ts';

test('buildRetrievalCoordinatorPlan allocates more budget to under-covered interests', () => {
  const plan = buildRetrievalCoordinatorPlan({
    topics: ['Gaming', 'AI'],
    currentCoverage: { gaming: 1, ai: 5 },
    targetPerTopic: 4,
    lanes: ['subscriptions', 'semantic', 'search', 'explore'],
  });

  const gaming = plan.topicBudgets.find((item) => item.topic === 'gaming');
  const ai = plan.topicBudgets.find((item) => item.topic === 'ai');

  assert.ok(gaming);
  assert.ok(ai);
  assert.ok(gaming.requiredCoverage > 0);
  assert.ok(gaming.laneAssignments.some((lane) => lane.lane === 'semantic'));
  assert.ok(ai.requiredCoverage === 0);
});

test('buildRetrievalCoordinatorPlan keeps budgets bounded and returns a total plan', () => {
  const plan = buildRetrievalCoordinatorPlan({
    topics: ['Design'],
    currentCoverage: { design: 2 },
    targetPerTopic: 3,
    lanes: ['subscriptions', 'rss', 'search'],
  });

  assert.equal(plan.topicBudgets.length, 1);
  assert.equal(plan.totalBudget > 0, true);
  assert.equal(plan.lanes.includes('search'), true);
});
