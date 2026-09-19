import test from 'node:test';
import assert from 'node:assert/strict';

import { extractGoogleProviderTokens, summarizeGoogleProviderTokens } from './auth.ts';
import { buildConceptCatalog, buildConceptsApiResponse, buildStoredOrDerivedAlgorithmIntentProfile } from './concepts.ts';
import { buildFeedResponse, normalizeClassificationRecord } from './feed.ts';
import { redactSensitiveValues } from './logging.ts';
import { buildYoutubeProviderSessionStateLog, buildYoutubeTokenCheckLog } from './youtube.ts';

test('normalizeClassificationRecord unwraps Supabase nested relation arrays', () => {
  const record = normalizeClassificationRecord([{ topics: ['AI', 'Productivity'], quality_score: 91 }]);

  assert.deepEqual(record?.topics, ['AI', 'Productivity']);
  assert.equal(record?.quality_score, 91);
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

test('buildFeedResponse still orders unmatched candidates by score', () => {
  const feed = buildFeedResponse(
    { id: 'alg-unmatched', name: 'Gaming', topic_weights: [{ topic: 'Gaming', weight: 90 }], rules: [] },
    [],
    [
      { id: 'low', external_id: 'low', title: 'Unrelated low score', base_score: 20, candidate_relevance: 'unmatched', topics: [] },
      { id: 'high', external_id: 'high', title: 'Unrelated high score', base_score: 90, candidate_relevance: 'unmatched', topics: [] },
    ],
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
