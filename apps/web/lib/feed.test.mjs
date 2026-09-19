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
