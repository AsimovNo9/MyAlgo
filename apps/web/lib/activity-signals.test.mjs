import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLearnedAffinityProfile, getCandidateLearnedAffinity } from './learned-profile.ts';

test('activity signals transfer bounded positive and negative taste to related candidates', () => {
  const watched = {
    external_id: 'watched', title: 'AI tutorial', channel_name: 'AI Lab',
    topics: ['AI'], format: 'tutorial', language: 'en', source_kind: 'subscription',
  };
  const related = {
    external_id: 'related', title: 'Another AI tutorial', channel_name: 'Other Lab',
    topics: ['AI'], format: 'tutorial', language: 'en', source_kind: 'discovery',
  };

  const positive = buildLearnedAffinityProfile([watched, related], [], [
    { external_id: 'watched', eventType: 'completed' },
  ]);
  const negative = buildLearnedAffinityProfile([watched, related], [], [
    { external_id: 'watched', eventType: 'skipped' },
  ]);

  assert.ok(getCandidateLearnedAffinity(positive, related) > 0);
  assert.ok(getCandidateLearnedAffinity(negative, related) < 0);
});