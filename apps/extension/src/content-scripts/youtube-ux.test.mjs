import test from 'node:test';
import assert from 'node:assert/strict';

import { getReplacementCandidates, getShelfCandidates } from './youtube-ux.ts';

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
