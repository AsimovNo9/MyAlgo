import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acquireWebSearchCandidates,
  buildWebSearchRequest,
  buildYoutubeRssFeedUrl,
  isRetrievalAllowed,
  mergeCandidateAcquisitionHistory,
  needsYoutubeMetadataRefresh,
  normalizeWebSearchResultsToYoutubeCandidates,
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


test('needsYoutubeMetadataRefresh retries fresh records that are missing channel IDs', () => {
  const now = Date.parse('2026-09-26T12:00:00.000Z');
  assert.equal(
    needsYoutubeMetadataRefresh({ channel_id: null, enrichedAt: '2026-09-26T11:59:00.000Z' }, now, 24 * 60 * 60 * 1000),
    true,
  );
  assert.equal(
    needsYoutubeMetadataRefresh({ channel_id: 'UC1234567890123456789012', enrichedAt: '2026-09-26T11:59:00.000Z' }, now, 24 * 60 * 60 * 1000),
    false,
  );
});


test('planned web-search requests stay bounded and preserve graph query provenance', () => {
  assert.deepEqual(
    buildWebSearchRequest({
      text: 'distributed systems tutorial',
      lane: 'topic',
      topics: ['distributed systems'],
      algorithmRevision: 'graph-2-abc12345',
    }, 100),
    {
      query: 'distributed systems tutorial',
      lane: 'topic',
      topics: ['distributed systems'],
      graphRevision: 'graph-2-abc12345',
      limit: 20,
    },
  );
});


test('web-search results become YouTube candidates that can be watch-page enriched', () => {
  const plan = {
    text: 'local first software tutorial',
    lane: 'topic',
    topics: ['local first software'],
    algorithmRevision: 'graph-2-search123',
  };
  const candidates = normalizeWebSearchResultsToYoutubeCandidates([
    { url: 'https://www.youtube.com/watch?v=video-a', title: 'Thin search title', snippet: 'Search snippet' },
    { url: 'https://youtu.be/video-b?t=30', title: 'Second result' },
    { url: 'https://example.com/not-youtube', title: 'Ignore me' },
    { url: 'https://www.youtube.com/watch?v=video-a', title: 'Duplicate' },
  ], plan, '2026-09-26T18:00:00.000Z');

  assert.deepEqual(candidates.map((item) => item.external_id), ['video-a', 'video-b']);
  assert.equal(candidates[0].provenance?.mechanism, 'web_search');
  assert.equal(candidates[0].provenance?.query, plan.text);
  assert.equal(candidates[0].provenance?.graph_revision, plan.algorithmRevision);
  assert.equal(candidates[0].description, 'Search snippet');
});


test('web-search acquisition is bounded, deduplicated, and returns enrichable YouTube IDs', async () => {
  const calls = [];
  const provider = {
    id: 'fixture-search',
    async search(request) {
      calls.push(request);
      return [
        { url: 'https://www.youtube.com/watch?v=shared-video', title: 'Shared' },
        { url: `https://www.youtube.com/watch?v=${request.lane}-video`, title: 'Lane result' },
      ];
    },
  };
  const plans = [
    { text: 'goal q', lane: 'goal', topics: [], algorithmRevision: 'graph-x' },
    { text: 'topic q', lane: 'topic', topics: ['x'], algorithmRevision: 'graph-x' },
    { text: 'creator q', lane: 'creator', topics: [], algorithmRevision: 'graph-x' },
  ];
  const candidates = await acquireWebSearchCandidates(provider, plans, '2026-09-26T18:10:00.000Z', 2, 5);

  assert.equal(calls.length, 2);
  assert.equal(calls.every((call) => call.limit === 5), true);
  assert.deepEqual(candidates.map((item) => item.external_id).sort(), ['goal-video', 'shared-video', 'topic-video']);
  assert.equal(candidates.every((item) => item.provenance?.mechanism === 'web_search'), true);
});
