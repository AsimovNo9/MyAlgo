import test from 'node:test';
import assert from 'node:assert/strict';

import { createReplacementSlotId, getNativeCardDecision, getReplacementCandidates, getReplacementPresentationMetadata, getShelfCandidates, isRenderContextStale, keepOutermostElements, planReplacementAssignments } from './youtube-ux.ts';

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

test('replacement candidates require current trace and eligible policy outcome', () => {
  const items = [
    { external_id: 'video-a', title: 'A', score: 80, visible: true, traceId: 'trace-a', policyOutcome: 'eligible' },
    { external_id: 'video-b', title: 'B', score: 90, visible: true },
    { external_id: 'video-c', title: 'C', score: 90, visible: true, traceId: 'trace-c', suppressed: true, policyOutcome: 'suppressed' },
    { external_id: 'video-d', title: 'D', score: 70, visible: true, traceId: 'trace-d', policyOutcome: 'eligible' },
  ];
  assert.deepEqual(
    getReplacementCandidates(items, ['video-a'], 6, 52).map((item) => item.external_id),
    ['video-d'],
  );
});

test('replacement assignment never reuses native source IDs or duplicate slots', () => {
  const items = [
    { external_id: 'native-a', title: 'Already native', score: 99, visible: true, traceId: 'trace-native', policyOutcome: 'eligible' },
    { external_id: 'candidate-a', title: 'Candidate A', score: 90, visible: true, traceId: 'trace-a', policyOutcome: 'eligible' },
    { external_id: 'candidate-b', title: 'Candidate B', score: 80, visible: true, traceId: 'trace-b', policyOutcome: 'eligible' },
  ];
  const slots = [
    { slotId: 'slot-1', sourceVideoId: 'native-a' },
    { slotId: 'slot-1', sourceVideoId: 'native-a' },
    { slotId: 'slot-2', sourceVideoId: 'native-b' },
  ];

  assert.deepEqual(
    planReplacementAssignments(items, slots, ['candidate-b'], 52).map((assignment) => ({
      slotId: assignment.slot.slotId,
      externalId: assignment.item.external_id,
    })),
    [{ slotId: 'slot-1', externalId: 'candidate-a' }],
  );
});

test('replacement assignment reports no work when there is no qualified candidate', () => {
  assert.deepEqual(
    planReplacementAssignments(
      [{ external_id: 'candidate-a', title: 'A', score: 51, visible: true, traceId: 'trace-a', policyOutcome: 'eligible' }],
      [{ slotId: 'slot-1', sourceVideoId: 'native-a' }],
      [],
      52,
    ),
    [],
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


test('outermost-card selection removes nested duplicate presentation targets', () => {
  const outer = { id: 'outer' };
  const inner = { id: 'inner' };
  const sibling = { id: 'sibling' };
  const contains = (parent, child) => parent === outer && child === inner;

  assert.deepEqual(
    keepOutermostElements([outer, inner, sibling], contains),
    [outer, sibling],
  );
});


test('reactivation semantics require a fresh manual generation rather than stale mutation reuse', () => {
  const stale = { generation: 7, routeKey: '/', mode: 'Work' };
  const current = { generation: 8, routeKey: '/', mode: 'Work' };
  assert.equal(isRenderContextStale(stale, current), true);
});


test('replacement slot identity changes with generation, route, position, and source', () => {
  const base = createReplacementSlotId(4, '/', 2, 'native-a');
  assert.equal(base, '4|/|2|native-a');
  assert.notEqual(createReplacementSlotId(5, '/', 2, 'native-a'), base);
  assert.notEqual(createReplacementSlotId(4, '/results?q=x', 2, 'native-a'), base);
  assert.notEqual(createReplacementSlotId(4, '/', 3, 'native-a'), base);
  assert.notEqual(createReplacementSlotId(4, '/', 2, 'native-b'), base);
});


test('replacement presentation metadata is explicit and generation scoped', () => {
  const assignment = {
    slot: { slotId: '8|/|3|native-a', sourceVideoId: 'native-a' },
    item: {
      external_id: 'replacement-a',
      title: 'Replacement A',
      score: 6,
      traceId: 'trace-a',
      policyOutcome: 'eligible',
    },
  };
  assert.deepEqual(
    getReplacementPresentationMetadata(assignment, 8, 'Learning'),
    {
      generation: 8,
      mode: 'Learning',
      score: 6,
      traceId: 'trace-a',
      slotId: '8|/|3|native-a',
      sourceVideoId: 'native-a',
      replacementVideoId: 'replacement-a',
    },
  );
});
