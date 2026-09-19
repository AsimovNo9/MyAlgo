import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchYoutubeSubscriptionFeed, resolveYoutubeAccessTokenCandidate } from './youtube.ts';

test('missing user should not silently return demo fixture content', async () => {
  const result = await fetchYoutubeSubscriptionFeed(undefined);

  assert.equal(result.source, 'unauthenticated');
  assert.deepEqual(result.items, []);
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
