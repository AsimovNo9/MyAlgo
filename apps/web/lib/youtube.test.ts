import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchYoutubeSubscriptionFeed } from './youtube';

test('missing user should not silently return demo fixture content', async () => {
  const result = await fetchYoutubeSubscriptionFeed(undefined);

  assert.equal(result.source, 'unauthenticated');
  assert.deepEqual(result.items, []);
});
