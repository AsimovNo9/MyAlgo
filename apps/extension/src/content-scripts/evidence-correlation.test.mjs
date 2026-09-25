import test from 'node:test';
import assert from 'node:assert/strict';

import { correlateEvidence } from '../lib/evidence-correlation.ts';

const exposure = (source, externalId, exposureId, observedAt) => ({
  kind: 'exposure',
  exposureId,
  content: { source, externalId },
  surface: 'home',
  observedAt,
  provenance: { connector: source, mechanism: 'test' },
});

const interaction = (source, externalId, interactionKind, observedAt, exposureId = null) => ({
  kind: 'interaction',
  content: { source, externalId },
  exposureId,
  interaction: interactionKind,
  observedAt,
  provenance: { connector: source, mechanism: 'test' },
});

test('generic correlation keeps provider identity and exposure context source-neutral', () => {
  const timelines = correlateEvidence(
    [
      exposure('youtube', 'video-1', 'yt-exp-1', '2026-09-25T10:00:00.000Z'),
      exposure('reddit', 'post-1', 'reddit-exp-1', '2026-09-25T10:00:00.000Z'),
    ],
    [
      interaction('youtube', 'video-1', 'clicked', '2026-09-25T10:01:00.000Z', 'yt-exp-1'),
      interaction('youtube', 'video-1', 'watched', '2026-09-25T10:02:00.000Z'),
      interaction('reddit', 'post-1', 'saved', '2026-09-25T10:01:00.000Z', 'reddit-exp-1'),
    ],
  );

  assert.deepEqual(timelines.map((timeline) => timeline.content), [
    { source: 'reddit', externalId: 'post-1' },
    { source: 'youtube', externalId: 'video-1' },
  ]);

  const youtube = timelines.find((timeline) => timeline.content.source === 'youtube');
  assert.deepEqual(youtube.correlations.map((item) => item.kind), [
    'surfaced_clicked',
    'clicked_watched',
    'surfaced_watched',
  ]);
  assert.equal(youtube.correlations[0].surfacedExposureId, 'yt-exp-1');

  const reddit = timelines.find((timeline) => timeline.content.source === 'reddit');
  assert.deepEqual(reddit.correlations, []);
  assert.equal(reddit.interactions[0].interaction, 'saved');
});

test('generic correlation never crosses source or content identity', () => {
  const timelines = correlateEvidence(
    [exposure('youtube', 'same-id', 'yt-exp', '2026-09-25T10:00:00.000Z')],
    [interaction('reddit', 'same-id', 'clicked', '2026-09-25T10:01:00.000Z', 'yt-exp')],
  );

  assert.deepEqual(timelines.map((timeline) => timeline.content), [
    { source: 'reddit', externalId: 'same-id' },
    { source: 'youtube', externalId: 'same-id' },
  ]);
  assert.equal(timelines.find((item) => item.content.source === 'reddit').correlations.length, 0);
  assert.equal(timelines.find((item) => item.content.source === 'youtube').correlations.length, 0);
});

test('generic correlation preserves deterministic exact-exposure matching and fallback', () => {
  const exposures = [
    exposure('youtube', 'video-1', 'exp-a', '2026-09-25T10:00:00.000Z'),
    exposure('youtube', 'video-1', 'exp-b', '2026-09-25T10:03:00.000Z'),
  ];

  const exact = correlateEvidence(
    exposures,
    [interaction('youtube', 'video-1', 'clicked', '2026-09-25T10:04:00.000Z', 'exp-b')],
  );
  assert.equal(exact[0].correlations[0].surfacedExposureId, 'exp-b');

  const fallback = correlateEvidence(
    exposures,
    [interaction('youtube', 'video-1', 'clicked', '2026-09-25T10:02:00.000Z')],
  );
  assert.equal(fallback[0].correlations[0].surfacedExposureId, 'exp-a');
});

test('generic correlation is deterministic across equivalent input copies', () => {
  const exposures = [exposure('youtube', 'video-1', 'exp', '2026-09-25T10:00:00.000Z')];
  const interactions = [
    interaction('youtube', 'video-1', 'clicked', '2026-09-25T10:01:00.000Z', 'exp'),
    interaction('youtube', 'video-1', 'watched', '2026-09-25T10:02:00.000Z'),
  ];

  assert.deepEqual(
    correlateEvidence(exposures, interactions),
    correlateEvidence(JSON.parse(JSON.stringify(exposures)), JSON.parse(JSON.stringify(interactions))),
  );
});
