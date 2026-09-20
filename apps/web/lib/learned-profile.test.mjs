import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLearnedAffinityProfile, buildPersistedAffinityRows, getCandidateLearnedAffinity, getStrongChannelAffinityTerms, learnedAffinityProfileFromRows } from './learned-profile.ts';

test('buildLearnedAffinityProfile derives bounded positive affinities from more-like-this feedback', () => {
  const candidate = {
    external_id: 'liked',
    title: 'Nintendo RPG review',
    channel_id: 'channel-nintendo',
    channel_name: 'Nintendo Lab',
    topics: ['Gaming', 'RPG'],
    format: 'review',
    language: 'en',
    source_kind: 'discovery',
  };

  const profile = buildLearnedAffinityProfile([candidate], [{ external_id: 'liked', eventType: 'more_like_this' }]);

  assert.equal(profile.topics.get('gaming'), 0.35);
  assert.equal(profile.channels.get('channel-nintendo'), 0.5);
  assert.equal(profile.formats.get('review'), 0.4);
  assert.equal(profile.languages.get('en'), 0.4);
  assert.equal(profile.sources.get('discovery'), 0.25);
  assert.equal(getCandidateLearnedAffinity(profile, candidate), 1);
});

test('getStrongChannelAffinityTerms returns only bounded positive creator signals', () => {
  const profile = buildLearnedAffinityProfile([
    { external_id: 'liked', title: 'Liked', channel_name: 'Preferred Creator', topics: ['AI'], source_kind: 'liked' },
    { external_id: 'other', title: 'Other', channel_name: 'Other Creator', topics: ['AI'], source_kind: 'subscription' },
  ], []);

  assert.deepEqual(getStrongChannelAffinityTerms(profile), ['preferred creator']);
});

test('negative feedback lowers learned affinity without exceeding bounds', () => {
  const candidate = {
    external_id: 'disliked',
    title: 'Mobile gaming news',
    channel_name: 'News Channel',
    topics: ['Gaming'],
    format: 'news',
    language: 'en',
    source_kind: 'subscription',
  };

  const profile = buildLearnedAffinityProfile(
    [candidate],
    Array.from({ length: 10 }, () => ({ external_id: 'disliked', eventType: 'not_interested' })),
  );

  assert.equal(profile.topics.get('gaming'), -1);
  assert.equal(getCandidateLearnedAffinity(profile, candidate), -1);
});

test('liked candidates seed positive taste affinities without explicit feedback', () => {
  const likedCandidate = {
    external_id: 'liked',
    title: 'Nintendo RPG review',
    channel_id: 'channel-nintendo',
    channel_name: 'Nintendo Lab',
    topics: ['Gaming', 'RPG'],
    format: 'review',
    language: 'en',
    source_kind: 'liked',
  };
  const relatedCandidate = {
    external_id: 'related',
    title: 'Another RPG review',
    channel_name: 'Different RPG Channel',
    topics: ['RPG'],
    format: 'review',
    language: 'en',
    source_kind: 'discovery',
  };

  const profile = buildLearnedAffinityProfile([likedCandidate, relatedCandidate], []);

  assert.equal(profile.topics.get('rpg'), 0.21);
  assert.equal(profile.formats.get('review'), 0.24);
  assert.equal(profile.languages.get('en'), 0.24);
  assert.ok(getCandidateLearnedAffinity(profile, relatedCandidate) > 0);
});

test('buildPersistedAffinityRows aggregates historical signals with evidence and timestamps', () => {
  const rows = buildPersistedAffinityRows([
    {
      external_id: 'historical',
      title: 'Historical RPG',
      channel_id: 'channel-rpg',
      channel_name: 'RPG Lab',
      topics: ['RPG'],
      format: 'review',
      language: 'en',
      source_kind: 'discovery',
    },
  ], [
    { external_id: 'historical', eventType: 'more_like_this', createdAt: '2026-09-01T00:00:00Z' },
  ], [
    { external_id: 'historical', eventType: 'completed', occurredAt: '2026-09-02T00:00:00Z' },
  ], '2026-09-20T00:00:00Z');

  const topic = rows.find((row) => row.facet === 'topic' && row.facet_key === 'rpg');
  assert.deepEqual(topic, {
    facet: 'topic',
    facet_key: 'rpg',
    signed_value: 0.595,
    confidence: 0.595,
    evidence_count: 2,
    first_observed_at: '2026-09-01T00:00:00Z',
    last_observed_at: '2026-09-02T00:00:00Z',
    source_signals: ['more_like_this', 'completed'],
    profile_revision: '2026-09-20T00:00:00Z',
  });
});

test('learnedAffinityProfileFromRows reconstructs bounded ranking maps', () => {
  const profile = learnedAffinityProfileFromRows([
    { facet: 'topic', facet_key: 'rpg', signed_value: 1.4 },
    { facet: 'channel', facet_key: 'channel-rpg', signed_value: -0.8 },
  ]);

  assert.equal(profile.topics.get('rpg'), 1);
  assert.equal(profile.channels.get('channel-rpg'), -0.8);
});