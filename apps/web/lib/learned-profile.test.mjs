import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLearnedAffinityProfile, getCandidateLearnedAffinity } from './learned-profile.ts';

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