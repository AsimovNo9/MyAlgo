import test from 'node:test';
import assert from 'node:assert/strict';

import { getNativeCardDecision, getReplacementCandidates, getShelfCandidates, isRenderContextStale } from './youtube-ux.ts';

const lowScoreFeed = [
  { external_id: 'video-a', title: 'Video A', score: 6, visible: true },
  { external_id: 'video-b', title: 'Video B', score: 1, visible: true },
  { external_id: 'video-c', title: 'Video C', score: -9, visible: true },
];

test('MVP scores are eligible for shelf presentation', () => {
  assert.deepEqual(
    getShelfCandidates(lowScoreFeed, 6, [], 0),
    [lowScoreFeed[0], lowScoreFeed[1]],
  );
});

test('MVP scores are eligible for replacement while negative feedback stays hidden', () => {
  assert.deepEqual(
    getReplacementCandidates(lowScoreFeed, ['video-a'], 6, 0),
    [lowScoreFeed[1]],
  );
});


test('native-card policy gates run before score visibility', () => {
  assert.deepEqual(
    getNativeCardDecision(
      { external_id: 'video-a', title: 'Video A', score: 99, visible: true },
      { sourceFiltered: true, minimumVisibleScore: 0 },
    ),
    { action: 'hide', reason: 'source_filter' },
  );
  assert.deepEqual(
    getNativeCardDecision(
      { external_id: 'video-a', title: 'Video A', score: 99, visible: false },
      { sourceFiltered: false, minimumVisibleScore: 0 },
    ),
    { action: 'hide', reason: 'runtime_policy' },
  );
  assert.deepEqual(
    getNativeCardDecision(
      { external_id: 'video-a', title: 'Video A', score: 99, visible: true, suppressed: true, policyOutcome: 'suppressed' },
      { sourceFiltered: false, minimumVisibleScore: 0 },
    ),
    { action: 'hide', reason: 'runtime_policy' },
  );
});

test('native-card score threshold applies only to ranked candidates', () => {
  assert.deepEqual(
    getNativeCardDecision(
      { external_id: 'video-a', title: 'Video A', score: -9, visible: true },
      { sourceFiltered: false, minimumVisibleScore: 0 },
    ),
    { action: 'hide', reason: 'score' },
  );
  assert.deepEqual(
    getNativeCardDecision(
      { external_id: 'video-b', title: 'Video B', score: 1, visible: true },
      { sourceFiltered: false, minimumVisibleScore: 0 },
    ),
    { action: 'show', reason: 'ranked' },
  );
});

test('unmatched native cards pass through in degraded coverage', () => {
  assert.deepEqual(
    getNativeCardDecision(undefined, { sourceFiltered: false, minimumVisibleScore: 0 }),
    { action: 'show', reason: 'unmatched' },
  );
});

test('render context rejects stale generation, route, or mode', () => {
  const current = { generation: 4, routeKey: '/results?search_query=test', mode: 'Work' };
  assert.equal(isRenderContextStale(current, current), false);
  assert.equal(isRenderContextStale({ ...current, generation: 3 }, current), true);
  assert.equal(isRenderContextStale({ ...current, routeKey: '/' }, current), true);
  assert.equal(isRenderContextStale({ ...current, mode: 'Relax' }, current), true);
});
