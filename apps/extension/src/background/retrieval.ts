import type { CandidateAcquisitionProvenance, RecommendationCandidate } from '@repo/shared-types';

export const RSS_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
export const MAX_RSS_CHANNELS_PER_REFRESH = 6;
export const MAX_RSS_ITEMS_PER_CHANNEL = 8;

const decodeXml = (value: string): string => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .trim();

const capture = (value: string, pattern: RegExp): string | null => {
  const match = value.match(pattern);
  return match?.[1] ? decodeXml(match[1]) : null;
};

export function buildYoutubeRssFeedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId.trim())}`;
}

export function parseYoutubeRssFeed(
  xml: string,
  acquiredAt: string,
  sourceUrl: string,
  limit = MAX_RSS_ITEMS_PER_CHANNEL,
): RecommendationCandidate[] {
  const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const candidates: RecommendationCandidate[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (candidates.length >= Math.max(0, limit)) break;
    const externalId = capture(entry, /<yt:videoId>([^<]+)<\/yt:videoId>/i);
    const channelId = capture(entry, /<yt:channelId>([^<]+)<\/yt:channelId>/i);
    const title = capture(entry, /<title>([\s\S]*?)<\/title>/i);
    if (!externalId || !title || seen.has(externalId)) continue;
    seen.add(externalId);

    const channelName = capture(entry, /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i);
    const publishedAt = capture(entry, /<published>([^<]+)<\/published>/i);
    const thumbnail = capture(entry, /<media:thumbnail\b[^>]*url=["']([^"']+)["'][^>]*\/?\s*>/i);
    const provenance: CandidateAcquisitionProvenance = {
      connector: 'youtube',
      mechanism: 'rss',
      acquired_at: acquiredAt,
      graph_revision: null,
      source_url: sourceUrl,
    };

    candidates.push({
      external_id: externalId,
      title,
      channel_id: channelId,
      channel_name: channelName,
      thumbnail_url: thumbnail,
      published_at: publishedAt,
      source_kind: 'discovery',
      provenance,
    });
  }

  return candidates;
}

export function selectRssChannelIds(
  records: Array<{ channel_id?: string | null; enrichedAt?: string | null }>,
  limit = MAX_RSS_CHANNELS_PER_REFRESH,
): string[] {
  const sorted = [...records].sort((left, right) => (
    new Date(right.enrichedAt ?? 0).getTime() - new Date(left.enrichedAt ?? 0).getTime()
  ));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const record of sorted) {
    const id = record.channel_id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= Math.max(0, limit)) break;
  }
  return result;
}

export function nextRssAllowedAt(
  nowMs: number,
  consecutiveFailures: number,
): string {
  if (consecutiveFailures <= 0) {
    return new Date(nowMs + RSS_REFRESH_INTERVAL_MS).toISOString();
  }
  const backoff = Math.min(
    60 * 60 * 1000,
    5 * 60 * 1000 * (2 ** Math.min(4, consecutiveFailures - 1)),
  );
  return new Date(nowMs + backoff).toISOString();
}

export function isRetrievalAllowed(nextAllowedAt: string | null | undefined, nowMs: number): boolean {
  if (!nextAllowedAt) return true;
  const timestamp = new Date(nextAllowedAt).getTime();
  return !Number.isFinite(timestamp) || timestamp <= nowMs;
}
