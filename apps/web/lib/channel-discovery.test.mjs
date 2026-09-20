import test from 'node:test';
import assert from 'node:assert/strict';

import { rankChannelCandidates, scoreChannelCandidate } from './channel-discovery.ts';

test('scoreChannelCandidate rewards topic matches and quality signals', () => {
  const focused = scoreChannelCandidate('Computer Vision', 'Computer Vision Research Lab', 'Research on computer vision and image models', 100000);
  const unrelated = scoreChannelCandidate('Computer Vision', 'Celebrity News', 'Daily entertainment updates', 100000);

  assert.ok(focused > 0.5);
  assert.ok(focused > unrelated);
});

test('scoreChannelCandidate returns zero when no usable topic exists', () => {
  assert.equal(scoreChannelCandidate('', 'Research Lab', 'Science', 1000), 0);
  assert.equal(scoreChannelCandidate('AI', '', '', null), 0);
});

test('rankChannelCandidates orders candidates by confidence', () => {
  const ranked = rankChannelCandidates([
    { topic: 'AI', channelId: 'low', channelName: 'Low', channelDescription: '', subscriberCount: null, confidence: 0.2 },
    { topic: 'AI', channelId: 'high', channelName: 'High', channelDescription: '', subscriberCount: null, confidence: 0.9 },
  ]);

  assert.deepEqual(ranked.map((candidate) => candidate.channelId), ['high', 'low']);
});

test('scoreChannelCandidate makes high-confidence topic matches eligible for auto-approval', () => {
  const confidence = scoreChannelCandidate(
    'Computer Vision',
    'Computer Vision Research Lab',
    'Computer vision image models and research',
    1000000,
  );

  assert.ok(confidence >= 0.75);
});
