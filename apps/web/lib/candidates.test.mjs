import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidateRawMetadata,
  createCandidateProvenance,
  hasSufficientSharedTopicPool,
  normalizeRssCandidate,
} from './candidates.ts';

test('normalizes RSS and Search-compatible candidate fields with provenance', () => {
  const candidate = normalizeRssCandidate({
    videoId: 'abc123',
    title: 'Reactor safety systems',
    channelName: 'Nuclear Engineering Institute',
    description: 'A systems overview',
    publishedAt: '2026-09-01T12:00:00Z',
    provenance: createCandidateProvenance('youtube_rss', {
      channel_id: 'UC_nuclear',
      retrievedAt: '2026-09-20T10:00:00Z',
    }),
  }, 'UC_nuclear');

  assert.deepEqual(candidate, {
    id: 'abc123',
    external_id: 'abc123',
    title: 'Reactor safety systems',
    channel_name: 'Nuclear Engineering Institute',
    channel_id: 'UC_nuclear',
    description: 'A systems overview',
    published_at: '2026-09-01T12:00:00Z',
    source_kind: 'discovery',
    provenance: {
      source: 'youtube_rss',
      query: null,
      query_lane: null,
      query_topics: [],
      channel_id: 'UC_nuclear',
      retrieved_at: '2026-09-20T10:00:00Z',
    },
  });
});

test('buildCandidateRawMetadata preserves bounded description and retrieval provenance', () => {
  const provenance = createCandidateProvenance('youtube_search', {
    query: 'Nintendo RPG guide',
    retrievedAt: '2026-09-20T10:00:00Z',
  });

  assert.deepEqual(buildCandidateRawMetadata({ description: null, provenance }), {
    description: null,
    retrieval: {
      source: 'youtube_search',
      query: 'Nintendo RPG guide',
      query_lane: null,
      query_topics: [],
      channel_id: null,
      retrieved_at: '2026-09-20T10:00:00Z',
    },
  });
});

test('buildCandidateRawMetadata persists optional enriched video metadata', () => {
  const metadata = { category_id: '28', duration_seconds: 120, tags: ['systems'] };

  assert.deepEqual(buildCandidateRawMetadata({
    description: 'Enriched description',
    provenance: createCandidateProvenance('youtube_search', { retrievedAt: '2026-09-20T10:00:00Z' }),
    metadata,
  }), {
    description: 'Enriched description',
    retrieval: {
      source: 'youtube_search',
      query: null,
      query_lane: null,
      query_topics: [],
      channel_id: null,
      retrieved_at: '2026-09-20T10:00:00Z',
    },
    metadata,
  });
});

test('hasSufficientSharedTopicPool recognizes classified RSS content case-insensitively', () => {
  const rows = Array.from({ length: 15 }, (_, index) => ({
    classifications: [{ topics: [index < 14 ? 'Gaming' : 'RPG'] }],
  }));

  assert.equal(hasSufficientSharedTopicPool(rows, ['gaming'], 14), true);
  assert.equal(hasSufficientSharedTopicPool(rows.slice(0, 13), ['Gaming'], 14), false);
  assert.equal(hasSufficientSharedTopicPool(rows, ['Engineering'], 1), false);
  assert.equal(hasSufficientSharedTopicPool(rows, [], 1), false);
});