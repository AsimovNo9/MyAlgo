import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acquireWebSearchCandidates,
  buildWebSearchRequest,
  buildYoutubeRssFeedUrl,
  isRetrievalAllowed,
  mergeCandidateAcquisitionHistory,
  needsYoutubeMetadataRefresh,
  nextRssAllowedAt,
  nextWebSearchAllowedAt,
  parseYoutubeRssFeed,
  selectRssChannelIds,
  shouldRefreshObservedCandidate,
} from './retrieval.ts';
import {
  createYoutubeSearchPageProvider,
  enrichYoutubeCandidate,
  parseYoutubeSearchResultsHtml,
} from '../connectors/youtube-acquisition.ts';

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
    }, '2026-09-26T18:00:00.000Z', 100),
    {
      query: 'distributed systems tutorial',
      lane: 'topic',
      topics: ['distributed systems'],
      graphRevision: 'graph-2-abc12345',
      acquiredAt: '2026-09-26T18:00:00.000Z',
      limit: 20,
    },
  );
});


test('web-search acquisition is bounded, deduplicated, and returns enrichable YouTube IDs', async () => {
  const calls = [];
  const provider = {
    id: 'fixture-search',
    async search(request) {
      calls.push(request);
      const makeCandidate = (externalId, title) => ({
        external_id: externalId,
        title,
        source_kind: 'discovery',
        provenance: {
          connector: 'fixture',
          mechanism: 'web_search',
          query: request.query,
          query_lane: request.lane,
          query_topics: request.topics,
          acquired_at: request.acquiredAt,
          graph_revision: request.graphRevision,
          source_url: `https://fixture.invalid/${externalId}`,
        },
      });
      return [
        makeCandidate('shared-video', 'Shared'),
        makeCandidate(`${request.lane}-video`, 'Lane result'),
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
  assert.equal(calls.every((call) => call.acquiredAt === '2026-09-26T18:10:00.000Z'), true);
});


test('observed candidate refreshes are coalesced inside the short persistence window', () => {
  const now = Date.parse('2026-09-26T19:00:00.000Z');
  assert.equal(
    shouldRefreshObservedCandidate('2026-09-26T18:59:45.000Z', now, 30_000),
    false,
  );
  assert.equal(
    shouldRefreshObservedCandidate('2026-09-26T18:59:20.000Z', now, 30_000),
    true,
  );
});


test('web-search refresh policy applies TTL and bounded failure backoff', () => {
  const now = Date.parse('2026-09-26T12:00:00.000Z');
  const success = nextWebSearchAllowedAt(now, 0);
  const failure = nextWebSearchAllowedAt(now, 2);
  assert.equal(Date.parse(success) - now, 15 * 60 * 1000);
  assert.equal(Date.parse(failure) - now, 4 * 60 * 1000);
});




test('YouTube search-page parser extracts bounded unique video results from ytInitialData', () => {
  const html = `
    <html><script>
      var ytInitialData = {
        "contents": [{
          "videoRenderer": {
            "videoId": "video-a",
            "title": {"runs":[{"text":"Distributed systems tutorial"}]},
            "descriptionSnippet":{"runs":[{"text":"Learn CRDTs"}]},
            "thumbnail":{"thumbnails":[
              {"url":"https://i.ytimg.com/vi/video-a/default.jpg","width":120},
              {"url":"https://i.ytimg.com/vi/video-a/hqdefault.jpg","width":480}
            ]}
          }
        },{
          "videoRenderer": {
            "videoId": "video-b",
            "title": {"simpleText":"Second result"},
            "thumbnail":{"thumbnails":[{"url":"https://i.ytimg.com/vi/video-b/hqdefault.jpg","width":480}]}
          }
        },{
          "compactVideoRenderer": {
            "videoId": "video-a",
            "title": {"simpleText":"Duplicate"}
          }
        }]
      };
    </script></html>
  `;

  const results = parseYoutubeSearchResultsHtml(html, 8);
  assert.deepEqual(results.map((item) => item.url), [
    'https://www.youtube.com/watch?v=video-a',
    'https://www.youtube.com/watch?v=video-b',
  ]);
  assert.equal(results[0].title, 'Distributed systems tutorial');
  assert.equal(results[0].snippet, 'Learn CRDTs');
  assert.equal(results[0].thumbnailUrl, 'https://i.ytimg.com/vi/video-a/hqdefault.jpg');
});

test('YouTube search provider uses generated query with existing YouTube host access', async () => {
  const requests = [];
  const provider = createYoutubeSearchPageProvider(async (url, options) => {
    requests.push({ url, options });
    return new Response(`
      <script>var ytInitialData = {
        "contents":[{"videoRenderer":{
          "videoId":"abc123",
          "title":{"simpleText":"Candidate"}
        }}]
      };</script>
    `, { status: 200, headers: { 'content-type': 'text/html' } });
  });

  const results = await provider.search({
    query: 'distributed systems tutorial',
    lane: 'goal',
    topics: ['distributed systems'],
    graphRevision: 'graph-x',
    acquiredAt: '2026-09-26T19:00:00.000Z',
    limit: 5,
  });

  assert.equal(provider.id, 'youtube_search_page');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /^https:\/\/www\.youtube\.com\/results\?/);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.searchParams.get('search_query'), 'distributed systems tutorial');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.deepEqual(results.map((item) => item.external_id), ['abc123']);
  assert.equal(results[0].provenance?.connector, 'youtube');
  assert.equal(results[0].provenance?.mechanism, 'web_search');
});


test('YouTube connector enrichment maps canonical watch metadata into provider-neutral candidate metadata', async () => {
  const enriched = await enrichYoutubeCandidate({
    external_id: 'abc123',
    title: 'Thin title',
    description: 'Thin description',
    topics: ['existing'],
    is_live: false,
  }, async (url, options) => {
    assert.equal(url, 'https://www.youtube.com/watch?v=abc123');
    assert.equal(options.credentials, 'omit');
    return new Response(`
      <script>var ytInitialPlayerResponse = {
        "videoDetails":{
          "title":"Rich title",
          "shortDescription":"Rich description",
          "lengthSeconds":"120",
          "channelId":"UC1234567890123456789012",
          "author":"Systems Lab",
          "keywords":["distributed","systems"],
          "thumbnail":{"thumbnails":[{"url":"large.jpg","width":1280}]},
          "viewCount":"42",
          "isLiveContent":false
        },
        "microformat":{"playerMicroformatRenderer":{
          "publishDate":"2026-09-26",
          "category":"Education"
        }}
      };</script>
    `, { status: 200 });
  });

  assert.equal(enriched.title, 'Rich title');
  assert.equal(enriched.channel_name, 'Systems Lab');
  assert.equal(enriched.channel_id, 'UC1234567890123456789012');
  assert.equal(enriched.duration_seconds, 120);
  assert.equal(enriched.content_type, 'Education');
  assert.equal(enriched.view_count, 42);
  assert.deepEqual(enriched.topics, ['existing', 'distributed', 'systems', 'Education']);
});
