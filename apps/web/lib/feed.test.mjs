import test from 'node:test';
import assert from 'node:assert/strict';

import { extractGoogleProviderTokens, summarizeGoogleProviderTokens } from './auth.ts';
import { buildConceptCatalog, buildConceptsApiResponse, buildStoredOrDerivedAlgorithmIntentProfile } from './concepts.ts';
import { buildFeedResponse, diversifyFeedItems, getEligibleTopicNames, getRankingTopicWeights, normalizeClassificationRecord } from './feed.ts';
import { fetchWithRetry } from './http.ts';
import { inferPageCandidateTopics } from './page-relevance.ts';
import { redactSensitiveValues } from './logging.ts';
import { buildYoutubeProviderSessionStateLog, buildYoutubeTokenCheckLog } from './youtube.ts';

test('normalizeClassificationRecord unwraps Supabase nested relation arrays', () => {
  const record = normalizeClassificationRecord([{ topics: ['AI', 'Productivity'], quality_score: 91, language: 'en', format: 'tutorial' }]);

  assert.deepEqual(record?.topics, ['AI', 'Productivity']);
  assert.equal(record?.quality_score, 91);
  assert.equal(record?.language, 'en');
  assert.equal(record?.format, 'tutorial');
});

test('buildFeedResponse hard-filters known language and format conflicts', () => {
  const feed = buildFeedResponse(
    {
      name: 'Learning',
      language: 'en',
      preferred_formats: ['tutorial'],
      topic_weights: [{ topic: 'AI', weight: 90 }],
      rules: [],
    },
    [],
    [
      { external_id: 'good', title: 'AI tutorial', topics: ['AI'], language: 'en', format: 'tutorial' },
      { external_id: 'language', title: 'AI tutorial', topics: ['AI'], language: 'ja', format: 'tutorial' },
      { external_id: 'format', title: 'AI review', topics: ['AI'], language: 'en', format: 'review' },
      { external_id: 'unknown', title: 'AI content', topics: ['AI'] },
    ],
  );

  assert.deepEqual(feed.items.map((item) => item.external_id), ['good', 'unknown']);
  assert.equal(feed.items.some((item) => item.reason?.includes('language mismatch')), false);
});

test('getEligibleTopicNames prevents low-weight secondary topics from admitting content', () => {
  const eligible = getEligibleTopicNames({
    name: 'Relax',
    topic_weights: [
      { topic: 'Entertainment', weight: 80 },
      { topic: 'Productivity', weight: 30 },
      { topic: 'AI', weight: 20 },
    ],
  });

  assert.deepEqual([...eligible], ['entertainment']);
});

test('inferPageCandidateTopics does not treat a channel brand as video relevance', () => {
  assert.deepEqual(inferPageCandidateTopics('Unrelated lifestyle documentary', ['IGN']), []);
  assert.deepEqual(inferPageCandidateTopics('IGN reviews a new RPG game', ['IGN', 'Gaming']), ['IGN', 'Gaming']);
});

test('getEligibleTopicNames keeps weight-50 topics eligible when all topics are weight 50', () => {
  const eligible = getEligibleTopicNames({
    name: 'Gaming',
    topic_weights: [{ topic: 'Games', weight: 50 }, { topic: 'Gaming news', weight: 50 }],
  });

  assert.deepEqual([...eligible], ['games', 'gaming news', 'gaming']);
});

test('getRankingTopicWeights adds a canonical concept from the algorithm name', () => {
  const weights = getRankingTopicWeights({
    name: 'Gaming',
    topic_weights: [{ topic: 'IGN', weight: 50 }],
  });

  assert.deepEqual(weights, [{ topic: 'IGN', weight: 50 }, { topic: 'Gaming', weight: 50 }]);
});

test('diversifyFeedItems limits repeated channels and numbered series', () => {
  const items = [
    { id: '1', external_id: '1', title: 'Wolverine Gameplay Part 1', channel_name: 'Gaming Hub', score: 100, visible: true },
    { id: '2', external_id: '2', title: 'Wolverine Gameplay Part 2', channel_name: 'Console Guides', score: 99, visible: true },
    { id: '3', external_id: '3', title: 'Wolverine Gameplay Part 3', channel_name: 'Walkthrough World', score: 98, visible: true },
    { id: '4', external_id: '4', title: 'New RPG release analysis', channel_name: 'Gaming Hub', score: 97, visible: true },
    { id: '5', external_id: '5', title: 'Indie game design interview', channel_name: 'Gaming Hub', score: 96, visible: true },
    { id: '6', external_id: '6', title: 'Computer Vision Research', channel_name: 'Vision Lab', score: 95, visible: true },
  ];

  assert.deepEqual(diversifyFeedItems(items).map((item) => item.external_id), ['1', '2', '4', '6']);
});

test('fetchWithRetry retries transient responses and returns the recovered response', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(attempts === 3 ? '{"ok":true}' : 'busy', { status: attempts === 3 ? 200 : 503 });
  };

  try {
    const response = await fetchWithRetry('https://example.com', undefined, { backoffMs: 0 });
    assert.equal(response.status, 200);
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchWithRetry aborts a hung request after the configured attempts', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    attempts += 1;
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  });

  try {
    await assert.rejects(
      fetchWithRetry('https://example.com', undefined, { maxAttempts: 2, timeoutMs: 1, backoffMs: 0 }),
      { name: 'AbortError' },
    );
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildConceptCatalog exposes persisted concept metadata in the API shape', () => {
  const catalog = buildConceptCatalog([
    {
      id: 'concept-ai',
      canonical_name: 'AI',
      aliases: ['LLM', 'machine learning'],
      intents: ['model training'],
    },
    {
      id: 'concept-empty',
      canonical_name: 'Unknown',
      aliases: null,
      intents: null,
    },
  ]);

  assert.deepEqual(catalog, [
    {
      id: 'concept-ai',
      canonicalName: 'AI',
      aliases: ['LLM', 'machine learning'],
      intents: ['model training'],
    },
    {
      id: 'concept-empty',
      canonicalName: 'Unknown',
      aliases: [],
      intents: [],
    },
  ]);
});

test('buildStoredOrDerivedAlgorithmIntentProfile preserves persisted user-scoped profile fields', () => {
  const profile = buildStoredOrDerivedAlgorithmIntentProfile({
    id: 'alg-1',
    name: 'Creative Strategy',
    goal_text: 'derive profile only when needed',
    topic_weights: [{ topic: 'Game Design', weight: 88 }],
    rules: [],
    algorithm_intent_profiles: [
      {
        canonical_topics: ['Custom Topic'],
        aliases: ['custom alias'],
        intents: ['custom intent'],
        semantic_terms: ['custom semantic phrase'],
      },
    ],
  });

  assert.deepEqual(profile, {
    canonicalTopics: ['Custom Topic'],
    aliases: ['custom alias'],
    intents: ['custom intent'],
    semanticTerms: ['custom semantic phrase'],
  });
});

test('buildStoredOrDerivedAlgorithmIntentProfile merges all returned persisted profile rows', () => {
  const profile = buildStoredOrDerivedAlgorithmIntentProfile({
    id: 'alg-1',
    name: 'Creative Strategy',
    goal_text: 'derive profile only when needed',
    topic_weights: [{ topic: 'Game Design', weight: 88 }],
    rules: [],
    algorithm_intent_profiles: [
      {
        canonical_topics: ['Custom Topic'],
        aliases: ['custom alias'],
        intents: ['custom intent'],
        semantic_terms: ['custom semantic phrase'],
      },
      {
        canonical_topics: ['Second Topic'],
        aliases: ['second alias'],
        intents: ['second intent'],
        semantic_terms: ['second semantic phrase'],
      },
    ],
  });

  assert.deepEqual(profile, {
    canonicalTopics: ['Custom Topic', 'Second Topic'],
    aliases: ['custom alias', 'second alias'],
    intents: ['custom intent', 'second intent'],
    semanticTerms: ['custom semantic phrase', 'second semantic phrase'],
  });
});

test('buildConceptsApiResponse keeps concept catalog and persisted profile fields in GET response shape', () => {
  const response = buildConceptsApiResponse({
    conceptEntries: [
      {
        id: 'concept-ai',
        canonical_name: 'AI',
        aliases: ['LLM'],
        intents: ['model training'],
      },
    ],
    algorithms: [
      {
        id: 'alg-1',
        name: 'Creative Strategy',
        goal_text: 'derive profile only when needed',
        topic_weights: [{ topic: 'Game Design', weight: 88 }],
        rules: [],
        algorithm_intent_profiles: [
          {
            canonical_topics: ['Custom Topic'],
            aliases: ['custom alias'],
            intents: ['custom intent'],
            semantic_terms: ['custom semantic phrase'],
          },
        ],
      },
    ],
  });

  assert.deepEqual(response, {
    concepts: [
      {
        id: 'concept-ai',
        canonicalName: 'AI',
        aliases: ['LLM'],
        intents: ['model training'],
      },
    ],
    profiles: [
      {
        algorithmId: 'alg-1',
        name: 'Creative Strategy',
        profile: {
          canonicalTopics: ['Custom Topic'],
          aliases: ['custom alias'],
          intents: ['custom intent'],
          semanticTerms: ['custom semantic phrase'],
        },
      },
    ],
  });
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
  assert.equal(feed.items.length, 1);
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

test('buildFeedResponse boosts more-like-this feedback without changing visibility', () => {
  const algorithm = { id: 'alg-feedback-boost', name: 'Work', topic_weights: [], rules: [] };
  const candidates = [
    { id: 'boosted', external_id: 'boosted', title: 'Candidate with positive feedback', base_score: 60 },
    { id: 'baseline', external_id: 'baseline', title: 'Candidate without feedback', base_score: 60 },
  ];

  const baseline = buildFeedResponse(algorithm, [], candidates);
  const boosted = buildFeedResponse(algorithm, [{ external_id: 'boosted', eventType: 'more_like_this' }], candidates);

  const baselineItem = baseline.items.find((item) => item.external_id === 'boosted');
  const boostedItem = boosted.items.find((item) => item.external_id === 'boosted');
  assert.ok(baselineItem && boostedItem);
  assert.equal(boostedItem.visible, true);
  assert.equal(boostedItem.score, baselineItem.score + 18);
  assert.match(boostedItem.reason ?? '', /more_like_this feedback/);
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
    { includeHidden: true },
  );

  assert.deepEqual(feed.items[0].matched_topics, []);
});

test('buildFeedResponse does not match short semantic terms inside unrelated words', () => {
  const feed = buildFeedResponse(
    { id: 'alg-semantic-boundary', name: 'Art', topic_weights: [{ topic: 'Art', weight: 90 }], semantic_terms: ['art'], rules: [] },
    [],
    [{ id: 'real-art', external_id: 'real-art', title: 'Party highlights and entertainment', topics: [] }],
    { includeHidden: true },
  );

  assert.deepEqual(feed.items[0].matched_topics, []);
  assert.equal(feed.items[0].visible, false);
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

test('buildFeedResponse suppresses gossip by content_type regardless of the channel', () => {
  const feed = buildFeedResponse(
    { id: 'alg-content-type', name: 'Work', topic_weights: [{ topic: 'AI', weight: 90 }], rules: [{ type: 'never_show', condition_text: 'gossip' }] },
    [],
    [{ id: 'trusted', external_id: 'trusted', title: 'Weekly AI research recap', channel_name: 'Trusted AI Lab', content_type: 'gossip', topics: ['AI'] }],
    { includeHidden: true },
  );

  assert.equal(feed.items[0].visible, false);
  assert.match(feed.items[0].reason ?? '', /never-show rule: gossip/);
});

test('buildFeedResponse pins a channel via an always-show rule naming it', () => {
  const feed = buildFeedResponse(
    { id: 'alg-channel-pin', name: 'Work', topic_weights: [{ topic: 'AI', weight: 90 }], rules: [{ type: 'always_show', condition_text: 'Nuclear Engineering Institute' }] },
    [],
    [{ id: 'pinned', external_id: 'pinned', title: 'Reactor safety systems overview', channel_name: 'Nuclear Engineering Institute', topics: [] }],
  );

  assert.equal(feed.items[0].visible, true);
  assert.match(feed.items[0].reason ?? '', /always-show rule: Nuclear Engineering Institute/);
});

test('buildFeedResponse hides unrelated content from topic-scoped feeds', () => {
  const feed = buildFeedResponse(
    { id: 'alg-relevance', name: 'AI', topic_weights: [{ topic: 'AI', weight: 90 }], rules: [] },
    [],
    [
      { id: 'match', external_id: 'match', title: 'AI systems overview', topics: ['AI'] },
      { id: 'unrelated', external_id: 'unrelated', title: 'Celebrity gossip recap', topics: ['Entertainment'] },
    ],
  );

  assert.deepEqual(feed.items.map((item) => item.external_id), ['match']);
});

test('buildFeedResponse returns an empty result when no topic-scoped candidates match', () => {
  const feed = buildFeedResponse(
    { id: 'alg-no-match', name: 'AI', topic_weights: [{ topic: 'AI', weight: 90 }], rules: [] },
    [],
    [{ id: 'unrelated', external_id: 'unrelated', title: 'Celebrity gossip recap', topics: ['Entertainment'] }],
  );

  assert.deepEqual(feed.items, []);
});

test('buildFeedResponse applies source controls without hiding unknown page provenance', () => {
  const feed = buildFeedResponse(
    { id: 'alg-sources', name: 'AI', topic_weights: [{ topic: 'AI', weight: 90 }], rules: [] },
    [],
    [
      { id: 'subscribed', external_id: 'subscribed', title: 'AI subscribed upload', source_kind: 'subscription', topics: ['AI'] },
      { id: 'discovery', external_id: 'discovery', title: 'AI discovery upload', source_kind: 'discovery', topics: ['AI'] },
      { id: 'short', external_id: 'short', title: 'AI short', source_kind: 'subscription', is_short: true, topics: ['AI'] },
      { id: 'unknown', external_id: 'unknown', title: 'AI page candidate', topics: ['AI'] },
    ],
    {
      sourceFilters: {
        subscribedOnly: true,
        includeDiscovery: false,
        includeShorts: false,
      },
    },
  );

  assert.deepEqual(feed.items.map((item) => item.external_id), ['subscribed', 'unknown']);
});

test('buildFeedResponse still orders unmatched candidates by score', () => {
  const feed = buildFeedResponse(
    { id: 'alg-unmatched', name: 'Gaming', topic_weights: [{ topic: 'Gaming', weight: 90 }], rules: [] },
    [],
    [
      { id: 'low', external_id: 'low', title: 'Unrelated low score', base_score: 20, candidate_relevance: 'unmatched', topics: [] },
      { id: 'high', external_id: 'high', title: 'Unrelated high score', base_score: 90, candidate_relevance: 'unmatched', topics: [] },
    ],
    { includeHidden: true },
  );

  assert.equal(feed.items[0].external_id, 'high');
  assert.equal(feed.items[1].external_id, 'low');
});

test('buildFeedResponse can return hidden candidates for page-level ranking', () => {
  const feed = buildFeedResponse(
    { id: 'alg-page', name: 'Gaming', topic_weights: [{ topic: 'Gaming', weight: 90 }], rules: [] },
    [],
    [
      { id: 'match', external_id: 'match', title: 'Gaming speedrun', base_score: 60, candidate_relevance: 'matched', topics: ['Gaming'] },
      { id: 'hidden', external_id: 'hidden', title: 'Unrelated news', base_score: 80, candidate_relevance: 'unmatched', topics: [] },
    ],
    { includeHidden: true },
  );

  assert.equal(feed.items.length, 2);
  assert.equal(feed.items.some((item) => item.external_id === 'hidden' && item.visible === false), true);
});

test('buildFeedResponse keeps explicit not-interested feedback suppressed', () => {
  const feed = buildFeedResponse(
    { id: 'alg-8', name: 'Gaming', topic_weights: [{ topic: 'Gaming', weight: 90 }], rules: [{ type: 'always_show', condition_text: 'speedrun' }] },
    [{ external_id: 'suppressed', eventType: 'not_interested' }],
    [{ id: 'suppressed', external_id: 'suppressed', title: 'Gaming speedrun', candidate_relevance: 'matched', topics: ['Gaming'] }],
    { includeHidden: true },
  );

  assert.equal(feed.items[0].visible, false);
});

test('buildFeedResponse keeps never-show rules stronger than always-show rules', () => {
  const ruleOrders = [
    [
      { type: 'always_show', condition_text: 'important' },
      { type: 'never_show', condition_text: 'important' },
    ],
    [
      { type: 'never_show', condition_text: 'important' },
      { type: 'always_show', condition_text: 'important' },
    ],
  ];

  for (const rules of ruleOrders) {
    const feed = buildFeedResponse(
      {
        id: 'alg-rule-precedence',
        name: 'Work',
        topic_weights: [],
        rules,
      },
      [],
      [{ id: 'blocked', external_id: 'blocked', title: 'Important update', base_score: 80 }],
    );

    assert.equal(feed.items[0].visible, false);
    assert.match(feed.items[0].reason ?? '', /never-show rule/);
  }
});

test('buildFeedResponse matches gaming concept aliases from title text and boosts the ranking', () => {
  const algorithm = {
    id: 'alg-9',
    name: 'Gaming',
    topic_weights: [{ topic: 'Gaming', weight: 90 }],
    rules: [],
  };

  const feed = buildFeedResponse(
    algorithm,
    [],
    [
      { id: 'gaming-match', external_id: 'gaming-match', title: 'Indie game design breakdown for gameplay systems', topics: [], base_score: 55 },
      { id: 'gaming-miss', external_id: 'gaming-miss', title: 'Celebrity gossip weekly recap', topics: [], base_score: 50 },
    ],
  );

  assert.equal(feed.items[0].external_id, 'gaming-match');
  assert.ok(feed.items[0].matched_topics.includes('Gaming'));
  assert.ok(feed.items[0].reason?.toLowerCase().includes('gaming'));
});

test('buildFeedResponse uses persisted semantic terms from the algorithm profile', () => {
  const algorithm = {
    id: 'alg-10',
    name: 'Indie Game Strategy',
    topic_weights: [{ topic: 'Strategy', weight: 88 }],
    semantic_terms: ['game design', 'gameplay systems', 'indie games'],
    rules: [],
  };

  const feed = buildFeedResponse(
    algorithm,
    [],
    [
      { id: 'persisted-match', external_id: 'persisted-match', title: 'Indie game design breakdown for gameplay systems', topics: [], base_score: 60 },
      { id: 'other-match', external_id: 'other-match', title: 'Startup business podcast', topics: [], base_score: 40 },
    ],
  );

  assert.equal(feed.items[0].external_id, 'persisted-match');
  assert.ok(feed.items[0].matched_topics.includes('Strategy'));
  assert.ok(feed.items[0].reason?.toLowerCase().includes('strategy'));
});

test('extractGoogleProviderTokens reads tokens from the session or the Google identity payload', () => {
  const providerSession = {
    provider_token: 'provider-access-token',
    provider_refresh_token: 'provider-refresh-token',
    user: {
      identities: [{ provider: 'google', identity_data: { access_token: 'identity-access-token', refresh_token: 'identity-refresh-token' } }],
    },
  };

  const providerTokens = extractGoogleProviderTokens(providerSession);
  assert.deepEqual(providerTokens, {
    accessToken: 'provider-access-token',
    refreshToken: 'provider-refresh-token',
    source: 'session_provider_token',
  });

  const identitySession = {
    provider_token: null,
    provider_refresh_token: null,
    user: {
      identities: [{ provider: 'google', identity_data: { access_token: 'identity-access-token', refresh_token: 'identity-refresh-token' } }],
    },
  };

  const identityTokens = extractGoogleProviderTokens(identitySession);
  assert.deepEqual(identityTokens, {
    accessToken: 'identity-access-token',
    refreshToken: 'identity-refresh-token',
    source: 'google_identity_data',
  });
});

test('summarizeGoogleProviderTokens exposes only safe diagnostic flags and never raw token values', () => {
  const session = {
    provider_token: 'provider-access-token',
    provider_refresh_token: 'provider-refresh-token',
    user: {
      identities: [{ provider: 'google', identity_data: { access_token: 'identity-access-token', refresh_token: 'identity-refresh-token' } }],
    },
  };

  const originalLog = console.log;
  const capturedArgs = [];
  console.log = (...args) => {
    capturedArgs.push(args);
  };

  try {
    const tokenSummary = summarizeGoogleProviderTokens(session);
    const expiresAt = Date.now() + 5 * 60 * 1000;
    console.log('YouTube provider session state', buildYoutubeProviderSessionStateLog('user-123', tokenSummary, null));
    console.log('YouTube token check', buildYoutubeTokenCheckLog('user-123', 'stored-access-token', 'stored-refresh-token', expiresAt));
    console.log(
      'YouTube token check',
      buildYoutubeTokenCheckLog('user-123', 'stored-access-token', 'stored-refresh-token', Date.now() + 30 * 1000),
    );

    const providerSessionState = capturedArgs[0]?.[1];
    const tokenCheckState = capturedArgs[1]?.[1];
    const expiringTokenCheckState = capturedArgs[2]?.[1];

    assert.deepEqual(providerSessionState, {
      userId: 'user-123',
      tokenSource: 'session_provider_token',
      hasSessionProviderToken: true,
      hasSessionProviderRefreshToken: true,
      hasGoogleIdentityToken: true,
      hasGoogleIdentityRefreshToken: true,
      hasAnyAccessToken: true,
      hasAnyRefreshToken: true,
      sessionError: null,
    });

    assert.equal(tokenCheckState.userId, 'user-123');
    assert.equal(tokenCheckState.hasAccessToken, true);
    assert.equal(tokenCheckState.hasRefreshToken, true);
    assert.equal(tokenCheckState.expiresAt, expiresAt);
    assert.equal(tokenCheckState.expiredSoon, false);
    assert.equal(expiringTokenCheckState.expiredSoon, true);
    assert.equal(JSON.stringify(capturedArgs).includes('provider-access-token'), false);
    assert.equal(JSON.stringify(capturedArgs).includes('identity-access-token'), false);
    assert.equal(JSON.stringify(capturedArgs).includes('stored-access-token'), false);
    assert.equal(JSON.stringify(capturedArgs).includes('stored-refresh-token'), false);
  } finally {
    console.log = originalLog;
  }
});

test('redactSensitiveValues strips tokens and secrets from structured log payloads', () => {
  const payload = {
    access_token: 'secret-access-token',
    refresh_token: 'secret-refresh-token',
    accessToken: 'camel-access-token',
    refreshToken: 'camel-refresh-token',
    nested: {
      client_secret: 'secret-client-secret',
      clientSecret: 'camel-client-secret',
      headers: {
        Authorization: 'Bearer secret-header-token',
      },
      url: 'https://example.com',
    },
    okay: 'visible-value',
  };

  const redacted = redactSensitiveValues(payload);

  assert.deepEqual(redacted, {
    access_token: '[REDACTED]',
    refresh_token: '[REDACTED]',
    accessToken: '[REDACTED]',
    refreshToken: '[REDACTED]',
    nested: {
      client_secret: '[REDACTED]',
      clientSecret: '[REDACTED]',
      headers: {
        Authorization: '[REDACTED]',
      },
      url: 'https://example.com',
    },
    okay: 'visible-value',
  });
});
