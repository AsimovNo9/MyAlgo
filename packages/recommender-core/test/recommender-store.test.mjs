import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryRecommendationStore } from '../src/index.ts';

test('memory recommendation store persists profile, interactions, and traces', () => {
  const store = createMemoryRecommendationStore({
    profile: {
      id: 'user-1',
      goal: 'Learn game design',
      explicitTopics: ['Gaming'],
      semanticTerms: ['game design'],
    },
  });

  store.upsertProfile({
    id: 'user-1',
    goal: 'Learn game design systems',
    explicitTopics: ['Gaming', 'RPG'],
    semanticTerms: ['game design', 'rpg systems'],
  });

  store.recordInteraction({
    id: 'interaction-1',
    userId: 'user-1',
    kind: 'click',
    itemId: 'item-1',
    topTopics: ['Gaming'],
    score: 0.91,
    ts: new Date('2026-01-01T00:00:00Z').toISOString(),
  });

  store.recordTrace({
    id: 'trace-1',
    userId: 'user-1',
    candidateId: 'item-1',
    retrievalLane: 'topic',
    score: 0.91,
    explanation: 'Matched gaming intent',
  });

  const profile = store.getProfile('user-1');
  const interactions = store.listInteractions('user-1');
  const traces = store.listTraces('user-1');

  assert.equal(profile?.goal, 'Learn game design systems');
  assert.equal(interactions.length, 1);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].explanation, 'Matched gaming intent');
});

test('memory recommendation store keeps a versioned export snapshot', () => {
  const store = createMemoryRecommendationStore();

  store.upsertProfile({
    id: 'user-2',
    goal: 'Learn AI workflows',
    explicitTopics: ['AI'],
    semanticTerms: ['ai workflows'],
  });

  const snapshot = store.exportSnapshot();

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.profiles['user-2'].goal, 'Learn AI workflows');
  assert.ok(Array.isArray(snapshot.interactions));
  assert.ok(Array.isArray(snapshot.traces));
});
