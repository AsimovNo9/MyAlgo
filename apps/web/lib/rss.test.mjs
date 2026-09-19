import test from 'node:test';
import assert from 'node:assert/strict';

import { parseYoutubeRssFeed } from './rss.ts';

const fixtureFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <id>yt:channel:UC_nuclear</id>
  <yt:channelId>UC_nuclear</yt:channelId>
  <title>Nuclear Engineering Institute</title>
  <author>
    <name>Nuclear Engineering Institute</name>
    <uri>https://www.youtube.com/channel/UC_nuclear</uri>
  </author>
  <entry>
    <id>yt:video:abc123</id>
    <yt:videoId>abc123</yt:videoId>
    <yt:channelId>UC_nuclear</yt:channelId>
    <title>Reactor safety systems &amp; design</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
    <author>
      <name>Nuclear Engineering Institute</name>
      <uri>https://www.youtube.com/channel/UC_nuclear</uri>
    </author>
    <published>2026-09-01T12:00:00+00:00</published>
    <media:group>
      <media:title>Reactor safety systems &amp; design</media:title>
      <media:description>A deep dive on containment &amp; safety.</media:description>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:def456</id>
    <yt:videoId>def456</yt:videoId>
    <title>Fuel cycle overview</title>
    <published>2026-08-15T09:30:00+00:00</published>
  </entry>
</feed>`;

test('parseYoutubeRssFeed extracts video entries with decoded titles and descriptions', () => {
  const items = parseYoutubeRssFeed(fixtureFeed);

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    videoId: 'abc123',
    title: 'Reactor safety systems & design',
    channelName: 'Nuclear Engineering Institute',
    description: 'A deep dive on containment & safety.',
    publishedAt: '2026-09-01T12:00:00+00:00',
  });
});

test('parseYoutubeRssFeed tolerates entries missing optional fields', () => {
  const items = parseYoutubeRssFeed(fixtureFeed);

  assert.deepEqual(items[1], {
    videoId: 'def456',
    title: 'Fuel cycle overview',
    channelName: null,
    description: null,
    publishedAt: '2026-08-15T09:30:00+00:00',
  });
});

test('parseYoutubeRssFeed ignores entries with no video id and returns an empty array for malformed input', () => {
  assert.deepEqual(parseYoutubeRssFeed('<entry><title>No video id here</title></entry>'), []);
  assert.deepEqual(parseYoutubeRssFeed('not xml at all'), []);
  assert.deepEqual(parseYoutubeRssFeed(''), []);
});
