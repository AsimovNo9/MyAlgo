import { fetchWithRetry } from './http.ts';

export type RssVideoItem = {
  videoId: string;
  title: string;
  channelName: string | null;
  description: string | null;
  publishedAt: string | null;
};

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTag(block: string, pattern: RegExp): string | null {
  const match = block.match(pattern);
  return match ? decodeXmlEntities(match[1].trim()) : null;
}

// Parses a YouTube channel Atom RSS feed (youtube.com/feeds/videos.xml) with targeted
// regex extraction instead of a full XML parser dependency; the feed's structure is
// stable and this only needs to be resilient, not a general-purpose XML reader.
export function parseYoutubeRssFeed(xml: string): RssVideoItem[] {
  const entryBlocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];

  return entryBlocks
    .map((block) => {
      const videoId = extractTag(block, /<yt:videoId>([^<]+)<\/yt:videoId>/);
      if (!videoId) {
        return null;
      }

      const title = extractTag(block, /<title>([^<]*)<\/title>/) ?? 'Untitled video';
      const channelName = extractTag(block, /<author>[\s\S]*?<name>([^<]*)<\/name>/);
      const publishedAt = extractTag(block, /<published>([^<]*)<\/published>/);
      const description = extractTag(block, /<media:description>([\s\S]*?)<\/media:description>/);

      return { videoId, title, channelName, description, publishedAt };
    })
    .filter((item): item is RssVideoItem => item !== null);
}

export async function fetchChannelRssItems(channelId: string): Promise<RssVideoItem[]> {
  const response = await fetchWithRetry(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`,
    undefined,
    { maxAttempts: 2, timeoutMs: 8000 },
  );

  if (!response.ok) {
    console.error('Failed to fetch YouTube RSS feed', channelId, response.status);
    return [];
  }

  return parseYoutubeRssFeed(await response.text());
}
