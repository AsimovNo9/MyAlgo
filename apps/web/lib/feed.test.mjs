import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFeedResponse, normalizeClassificationRecord } from './feed.ts';

test('normalizeClassificationRecord unwraps Supabase nested relation arrays', () => {
  const record = normalizeClassificationRecord([{ topics: ['AI', 'Productivity'], quality_score: 91 }]);

  assert.deepEqual(record?.topics, ['AI', 'Productivity']);
  assert.equal(record?.quality_score, 91);
});

test('buildFeedResponse ranks real synchronized items instead of demo fixtures', () => {
  const algorithm = {
    id: 'alg-1',
    name: 'Work',
    topic_weights: [
      { topic: 'AI', weight: 90 },
      { topic: 'Productivity', weight: 70 },
    ],
    rules: [],
  };

  const feed = buildFeedResponse(
    algorithm,
    [],
    [
      {
        id: 'real-1',
        external_id: 'yt-live-1',
        title: 'AI agents for product teams',
        channel_name: 'Systems Lab',
        base_score: 60,
        topics: ['AI', 'Productivity'],
      },
      {
        id: 'real-2',
        external_id: 'yt-live-2',
        title: 'Celebrity gossip weekly recap',
        channel_name: 'Tabloid Hour',
        base_score: 40,
        topics: ['Entertainment'],
      },
    ],
  );

  assert.equal(feed.items[0].external_id, 'yt-live-1');
  assert.ok(feed.items[0].score >= feed.items[1].score);
  assert.equal(feed.items[1].visible, true);
  assert.ok(feed.items[0].matched_topics.includes('AI'));
});

test('buildFeedResponse explains why a ranked item was boosted', () => {
  const algorithm = {
    id: 'alg-1',
    name: 'Work',
    topic_weights: [
      { topic: 'AI', weight: 90 },
      { topic: 'Productivity', weight: 70 },
    ],
    rules: [
      { id: 'rule-1', type: 'priority', condition_text: 'AI agents' },
    ],
  };

  const feed = buildFeedResponse(
    algorithm,
    [{ external_id: 'yt-live-1', eventType: 'more_like_this' }],
    [
      {
        id: 'real-1',
        external_id: 'yt-live-1',
        title: 'AI agents for product teams',
        channel_name: 'Systems Lab',
        base_score: 60,
        topics: ['AI', 'Productivity'],
      },
    ],
  );

  assert.match(feed.items[0].reason ?? '', /AI/i);
  assert.match(feed.items[0].reason ?? '', /priority|boost/i);
  assert.match(feed.items[0].reason ?? '', /more like this|feedback/i);
});

test('buildFeedResponse falls back to title-derived topics when classifications are empty', () => {
  const algorithm = {
    id: 'alg-2',
    name: 'Work',
    topic_weights: [
      { topic: 'AI', weight: 90 },
      { topic: 'Productivity', weight: 70 },
    ],
    rules: [{ id: 'rule-2', type: 'priority', condition_text: 'AI agents' }],
  };

  const feed = buildFeedResponse(
    algorithm,
    [],
    [{
      id: 'real-2',
      external_id: 'yt-live-2',
      title: 'AI agents for product teams',
      channel_name: 'Systems Lab',
      base_score: 60,
      topics: [],
    }],
  );

  assert.ok(feed.items[0].matched_topics.includes('AI'));
  assert.match(feed.items[0].reason ?? '', /AI/i);
  assert.ok(feed.items[0].score > 60);
});

test('buildFeedResponse differentiates items using channel relevance and freshness signals', () => {
  const algorithm = {
    id: 'alg-3',
    name: 'Work',
    topic_weights: [
      { topic: 'AI', weight: 90 },
      { topic: 'Productivity', weight: 70 },
    ],
    rules: [],
  };

  const now = Date.now();
  const feed = buildFeedResponse(
    algorithm,
    [],
    [
      {
        id: 'real-3',
        external_id: 'yt-live-3',
        title: 'AI agents for product teams',
        channel_name: 'Systems Lab',
        base_score: 78,
        published_at: new Date(now - 18 * 60 * 60 * 1000).toISOString(),
        topics: ['AI', 'Productivity'],
      },
      {
        id: 'real-4',
        external_id: 'yt-live-4',
        title: 'AI agents for product teams',
        channel_name: 'Tabloid Hour',
        base_score: 78,
        published_at: new Date(now - 12 * 24 * 60 * 60 * 1000).toISOString(),
        topics: ['AI', 'Productivity'],
      },
    ],
  );

  assert.ok(Math.abs(feed.items[0].score - feed.items[1].score) > 3);
  assert.ok(feed.items[0].score > feed.items[1].score);
});

test('buildFeedResponse hides every item from a channel after never-show feedback', () => {
  const algorithm = {
    id: 'alg-4',
    name: 'Work',
    topic_weights: [{ topic: 'AI', weight: 90 }],
    rules: [],
  };

  const feed = buildFeedResponse(
    algorithm,
    [{ external_id: 'yt-feedback', channel_id: 'channel-hidden', eventType: 'never_show_channel' }],
    [
      { id: 'hidden-1', external_id: 'yt-feedback', channel_id: 'channel-hidden', title: 'AI systems episode one', channel_name: 'Systems Lab', topics: ['AI'] },
      { id: 'hidden-2', external_id: 'yt-other', channel_id: 'channel-hidden', title: 'AI systems episode two', channel_name: 'Systems Lab', topics: ['AI'] },
    ],
  );

  assert.equal(feed.items.every((item) => item.visible === false), true);
});

test('buildFeedResponse does not infer AI from words containing ai as a substring', () => {
  const feed = buildFeedResponse(
    { id: 'alg-5', name: 'Work', topic_weights: [{ topic: 'AI', weight: 90 }], rules: [] },
    [],
    [{ id: 'real-5', external_id: 'yt-documentary', title: 'Un opéra pour un empire | Documentaire | ARTE', topics: [] }],
  );

  assert.deepEqual(feed.items[0].matched_topics, []);
});

test('buildFeedResponse keeps a relevant subscribed video above discovery content', () => {
  const algorithm = {
    id: 'alg-6',
    name: 'Work',
    topic_weights: [{ topic: 'AI', weight: 90 }],
    rules: [],
  };

  const feed = buildFeedResponse(algorithm, [], [
    { id: 'discovery', external_id: 'discovery', title: 'AI computer vision agents', source_kind: 'discovery', subscription_affinity: 0, topics: ['AI'] },
    { id: 'subscribed', external_id: 'subscribed', title: 'AI computer vision agents', source_kind: 'subscription', subscription_affinity: 25, topics: ['AI'] },
  ]);

  assert.equal(feed.items[0].external_id, 'subscribed');
});

test('buildFeedResponse filters unmatched candidates while preserving always-show rules', () => {
  const algorithm = {
    id: 'alg-7',
    name: 'Gaming',
    topic_weights: [{ topic: 'Gaming', weight: 90 }],
    rules: [{ id: 'rule-7', type: 'always_show', condition_text: 'speedrun' }],
  };

  const feed = buildFeedResponse(algorithm, [], [
    { id: 'match', external_id: 'match', title: 'Gaming speedrun', candidate_relevance: 'matched', topics: ['Gaming'] },
    { id: 'always', external_id: 'always', title: 'Speedrun documentary', candidate_relevance: 'unmatched', topics: [] },
    { id: 'hidden', external_id: 'hidden', title: 'Celebrity skincare', candidate_relevance: 'unmatched', topics: [] },
  ]);

  assert.equal(feed.items.some((item) => item.external_id === 'match'), true);
  assert.equal(feed.items.some((item) => item.external_id === 'always'), true);
  assert.equal(feed.items.some((item) => item.external_id === 'hidden'), false);
});

test('buildFeedResponse keeps explicit not-interested feedback suppressed', () => {
  const feed = buildFeedResponse(
    { id: 'alg-8', name: 'Gaming', topic_weights: [{ topic: 'Gaming', weight: 90 }], rules: [{ type: 'always_show', condition_text: 'speedrun' }] },
    [{ external_id: 'suppressed', eventType: 'not_interested' }],
    [{ id: 'suppressed', external_id: 'suppressed', title: 'Gaming speedrun', candidate_relevance: 'matched', topics: ['Gaming'] }],
  );

  assert.equal(feed.items[0].visible, false);
});
