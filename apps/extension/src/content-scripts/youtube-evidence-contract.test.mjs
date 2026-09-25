import assert from 'node:assert/strict';
import test from 'node:test';
import { youtubeConnector } from '../connectors/youtube.ts';
import { toNormalizedInteraction, createSelectionObservation } from './youtube-interactions.ts';
import { collectRecommendationObservations, toNormalizedExposure } from './youtube-recommendations.ts';

test('YouTube connector maps content identity and exposure without leaking YouTube IDs into the contract', () => {
  const exposure = toNormalizedExposure({
    externalId: 'abc123',
    exposureId: 'abc123|home||4',
    title: 'Example video',
    creator: 'Example creator',
    position: 4,
    section: null,
    observedAt: '2026-09-25T20:00:00.000Z',
    provenance: 'youtube_home_dom',
    evidenceKind: 'surfaced',
    outcome: 'unobserved',
  });

  assert.deepEqual(exposure.content, { source: 'youtube', externalId: 'abc123' });
  assert.equal(exposure.kind, 'exposure');
  assert.equal(exposure.surface, 'home');
  assert.equal(exposure.position, 4);
  assert.deepEqual(exposure.provenance, {
    connector: 'youtube',
    mechanism: 'home_dom',
  });
  assert.equal(exposure.metadata?.title, 'Example video');
});

test('selection and player-style watch evidence map to generic interactions', () => {
  const selection = createSelectionObservation(
    {
      videoId: 'abc123',
      exposure: {
        videoId: 'abc123',
        exposureId: 'abc123|home||4',
        surface: 'home',
        section: null,
        position: 4,
      },
      source: 'card',
    },
    'click',
    '2026-09-25T20:00:01.000Z',
  );

  assert.deepEqual(toNormalizedInteraction(selection), {
    kind: 'interaction',
    content: { source: 'youtube', externalId: 'abc123' },
    exposureId: 'abc123|home||4',
    interaction: 'clicked',
    observedAt: '2026-09-25T20:00:01.000Z',
    provenance: { connector: 'youtube', mechanism: 'user_interaction' },
    sessionId: null,
    metrics: undefined,
    metadata: null,
  });

  const watch = youtubeConnector.createInteraction({
    externalId: 'abc123',
    exposureId: null,
    interaction: 'watched',
    observedAt: '2026-09-25T20:00:31.000Z',
    mechanism: 'player_telemetry',
    sessionId: 'abc123|player|1',
    metrics: { playedSeconds: 30.2, thresholdSeconds: 30 },
  });

  assert.equal(watch.content.source, 'youtube');
  assert.equal(watch.interaction, 'watched');
  assert.equal(watch.exposureId, null);
  assert.equal(watch.sessionId, 'abc123|player|1');
  assert.equal(watch.metrics?.playedSeconds, 30.2);
});


test('Home recommendation observations reject placeholder titles', () => {
  const result = collectRecommendationObservations([
    { href: 'https://www.youtube.com/watch?v=placeholder', title: 'Watch', creator: null },
    { href: 'https://www.youtube.com/watch?v=real123', title: 'Real video', creator: 'Creator' },
  ], '2026-09-25T20:01:30.000Z');

  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].externalId, 'real123');
  assert.equal(result.observations[0].title, 'Real video');
  assert.equal(result.metrics.missingTitle, 1);
});

test('History watched evidence preserves title and creator metadata', () => {
  const watched = toNormalizedInteraction({
    videoId: 'history123',
    exposureId: null,
    title: 'History video',
    creator: 'History creator',
    kind: 'watched',
    source: 'history',
    observedAt: '2026-09-25T20:01:00.000Z',
    provenance: 'youtube_history_dom',
  });

  assert.equal(watched.interaction, 'watched');
  assert.deepEqual(watched.metadata, {
    title: 'History video',
    creatorId: null,
    creatorName: 'History creator',
    description: null,
    durationSeconds: null,
    publishedAt: null,
    language: null,
    format: null,
    contentType: null,
  });
});
