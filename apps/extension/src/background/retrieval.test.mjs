import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildYoutubeRssFeedUrl,
  isRetrievalAllowed,
  mergeCandidateAcquisitionHistory,
  nextRssAllowedAt,
  parseYoutubeRssFeed,
  selectRssChannelIds,
} from './retrieval.ts';

test('parseYoutubeRssFeed normalizes bounded candidates with source-neutral RSS provenance', () => {
  const xml = `
    <feed>
      <entry>
        <yt:videoId>video-a</yt:videoId>
        <yt:channelId>channel-a</yt:channelId>
        <title>Local-first &amp; distributed systems</title>
        <author><name>Creator A</name></author>
        <published>2026-09-26T10:00:00+00:00</published>
        <media:group><media:thumbnail url="https://i.ytimg.com/vi/video-a/hqdefault.jpg"/></media:group>
      </entry>
      <entry>
        <yt:videoId>video-a</yt:videoId>
        <title>Duplicate</title>
      </entry>
      <entry>
        <yt:videoId>video-b</yt:videoId>
        <yt:channelId>channel-b</yt:channelId>
        <title>Second video</title>
      </entry>
    </feed>
  `;
  const sourceUrl = buildYoutubeRssFeedUrl('channel-a');
  const items = parseYoutubeRssFeed(xml, '2026-09-26T12:00:00.000Z', sourceUrl, 5);

  assert.equal(items.length, 2);
  assert.equal(items[0].external_id, 'video-a');
  assert.equal(items[0].title, 'Local-first & distributed systems');
  assert.equal(items[0].channel_id, 'channel-a');
  assert.equal(items[0].source_kind, 'discovery');
  assert.deepEqual(items[0].provenance, {
    connector: 'youtube',
    mechanism: 'rss',
    acquired_at: '2026-09-26T12:00:00.000Z',
    graph_revision: null,
    source_url: sourceUrl,
  });
});

test('selectRssChannelIds deduplicates and prefers recently enriched channels', () => {
  assert.deepEqual(
    selectRssChannelIds([
      { channel_id: 'older', enrichedAt: '2026-09-24T00:00:00.000Z' },
      { channel_id: 'newer', enrichedAt: '2026-09-26T00:00:00.000Z' },
      { channel_id: 'older', enrichedAt: '2026-09-25T00:00:00.000Z' },
      { channel_id: null, enrichedAt: '2026-09-27T00:00:00.000Z' },
    ], 2),
    ['newer', 'older'],
  );
});

test('RSS refresh policy applies success TTL and bounded exponential backoff', () => {
  const now = Date.parse('2026-09-26T12:00:00.000Z');
  const success = nextRssAllowedAt(now, 0);
  const failure = nextRssAllowedAt(now, 2);

  assert.equal(isRetrievalAllowed(success, now), false);
  assert.equal(isRetrievalAllowed(success, Date.parse(success)), true);
  assert.equal(Date.parse(failure) - now, 10 * 60 * 1000);
});


test('mergeCandidateAcquisitionHistory preserves distinct observed and RSS acquisition paths', () => {
  const observed = {
    connector: 'youtube',
    mechanism: 'observed_dom',
    acquired_at: '2026-09-26T10:00:00.000Z',
    graph_revision: null,
    source_url: null,
  };
  const rss = {
    connector: 'youtube',
    mechanism: 'rss',
    acquired_at: '2026-09-26T11:00:00.000Z',
    graph_revision: 'graph-2-abc12345',
    source_url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC1234567890123456789012',
  };
  const history = mergeCandidateAcquisitionHistory([observed], rss);

  assert.equal(history.length, 2);
  assert.deepEqual(history.map((item) => item.mechanism), ['rss', 'observed_dom']);
  assert.equal(history[0].graph_revision, 'graph-2-abc12345');
});
