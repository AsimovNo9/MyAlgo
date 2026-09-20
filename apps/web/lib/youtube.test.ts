import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchYoutubeSubscriptionFeed, getDiscoverySearchOrder, mapYoutubeLikedItems, resolveYoutubeAccessTokenCandidate } from './youtube.ts';

test('missing user should not silently return demo fixture content', async () => {
  const result = await fetchYoutubeSubscriptionFeed(undefined);

  assert.equal(result.source, 'unauthenticated');
  assert.deepEqual(result.items, []);
});

test('mapYoutubeLikedItems normalizes liked metadata as a distinct candidate source', () => {
  const items = mapYoutubeLikedItems([
    {
      id: 'liked-1',
      snippet: {
        title: 'Nintendo RPG review',
        channelTitle: 'RPG Lab',
        channelId: 'channel-rpg',
        description: 'A review of a new RPG.',
        publishedAt: '2026-09-20T10:00:00Z',
      },
    },
    { id: 'missing-title', snippet: {} },
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].source_kind, 'liked');
  assert.equal(items[0].provenance?.source, 'youtube_liked');
  assert.equal(items[0].channel_id, 'channel-rpg');
});

test('resolveYoutubeAccessTokenCandidate only uses identity tokens before persistence as a bootstrap fallback', () => {
  assert.equal(
    resolveYoutubeAccessTokenCandidate(
      {
        accessToken: 'session-access-token',
        refreshToken: 'session-refresh-token',
        source: 'session_provider_token',
      },
      true,
    ),
    'session-access-token',
  );

  assert.equal(
    resolveYoutubeAccessTokenCandidate(
      {
        accessToken: 'identity-access-token',
        refreshToken: 'identity-refresh-token',
        source: 'google_identity_data',
      },
      true,
    ),
    null,
  );

  assert.equal(
    resolveYoutubeAccessTokenCandidate(
      {
        accessToken: 'identity-access-token',
        refreshToken: 'identity-refresh-token',
        source: 'google_identity_data',
      },
      false,
    ),
    'identity-access-token',
  );
});

test('discovery search uses relevance ordering except for freshness queries', () => {
  assert.equal(getDiscoverySearchOrder('topic'), 'relevance');
  assert.equal(getDiscoverySearchOrder('intent'), 'relevance');
  assert.equal(getDiscoverySearchOrder('creator'), 'relevance');
  assert.equal(getDiscoverySearchOrder('format'), 'relevance');
  assert.equal(getDiscoverySearchOrder('freshness'), 'date');
});
