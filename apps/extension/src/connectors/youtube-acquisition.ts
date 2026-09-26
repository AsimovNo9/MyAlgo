import type {
  CandidateAcquisitionProvenance,
  RecommendationCandidate,
} from '@repo/shared-types';
import { extractYouTubeVideoId, extractYouTubeWatchMetadataFromHtml } from '../content-scripts/youtube-dom';
import type {
  ProviderAcquisitionConnector,
  ProviderEnrichmentInput,
  ProviderEnrichmentResult,
  WebSearchProvider,
  WebSearchRequest,
} from './types';

export const MAX_RSS_CHANNELS_PER_REFRESH = 6;
export const MAX_RSS_ITEMS_PER_CHANNEL = 8;

const decodeXml = (value: string): string => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .trim();

const captureXml = (value: string, pattern: RegExp): string | null => {
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
    const externalId = captureXml(entry, /<yt:videoId>([^<]+)<\/yt:videoId>/i);
    const channelId = captureXml(entry, /<yt:channelId>([^<]+)<\/yt:channelId>/i);
    const title = captureXml(entry, /<title>([\s\S]*?)<\/title>/i);
    if (!externalId || !title || seen.has(externalId)) continue;
    seen.add(externalId);

    const channelName = captureXml(entry, /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i);
    const publishedAt = captureXml(entry, /<published>([^<]+)<\/published>/i);
    const thumbnail = captureXml(entry, /<media:thumbnail\b[^>]*url=["']([^"']+)["'][^>]*\/?\s*>/i);
    candidates.push({
      external_id: externalId,
      title,
      channel_id: channelId,
      channel_name: channelName,
      thumbnail_url: thumbnail,
      published_at: publishedAt,
      source_kind: 'discovery',
      provenance: {
        connector: 'youtube',
        mechanism: 'rss',
        acquired_at: acquiredAt,
        graph_revision: null,
        source_url: sourceUrl,
      },
    });
  }
  return candidates;
}

export function selectYoutubeRssChannelIds(
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

export function needsYoutubeMetadataRefresh(
  record: { channel_id?: string | null; enrichedAt?: string | null } | undefined,
  nowMs: number,
  refreshMs: number,
): boolean {
  if (!record?.channel_id?.trim()) return true;
  const enrichedAt = new Date(record.enrichedAt ?? 0).getTime();
  return !Number.isFinite(enrichedAt) || nowMs - enrichedAt > refreshMs;
}

type JsonObject = Record<string, unknown>;

const isJsonObject = (value: unknown): value is JsonObject =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

function extractAssignedJson(html: string, markers: string[]): unknown | null {
  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) continue;
    const start = html.indexOf('{', markerIndex + marker.length);
    if (start < 0) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < html.length; index += 1) {
      const char = html[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

const rendererText = (value: unknown): string | null => {
  if (!isJsonObject(value)) return null;
  if (typeof value.simpleText === 'string') return value.simpleText.trim() || null;
  if (!Array.isArray(value.runs)) return null;
  const text = value.runs
    .map((run) => isJsonObject(run) && typeof run.text === 'string' ? run.text : '')
    .join('')
    .trim();
  return text || null;
};

const rendererThumbnail = (value: unknown): string | null => {
  if (!isJsonObject(value) || !Array.isArray(value.thumbnails)) return null;
  const candidates = value.thumbnails
    .filter((item): item is JsonObject => isJsonObject(item) && typeof item.url === 'string')
    .sort((left, right) => Number(right.width ?? 0) - Number(left.width ?? 0));
  return typeof candidates[0]?.url === 'string' ? candidates[0].url : null;
};

type ParsedSearchResult = {
  url: string;
  title: string;
  snippet?: string | null;
  publishedAt?: string | null;
  thumbnailUrl?: string | null;
};

export function parseYoutubeSearchResultsHtml(
  html: string,
  limit = 20,
): ParsedSearchResult[] {
  const data = extractAssignedJson(html, [
    'var ytInitialData =',
    'ytInitialData =',
    'window["ytInitialData"] =',
  ]);
  if (!data) return [];

  const results: ParsedSearchResult[] = [];
  const seen = new Set<string>();
  const boundedLimit = Math.max(0, Math.min(50, Math.floor(limit)));

  const visit = (value: unknown): void => {
    if (results.length >= boundedLimit) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
        if (results.length >= boundedLimit) break;
      }
      return;
    }
    if (!isJsonObject(value)) return;

    for (const rendererKey of ['videoRenderer', 'gridVideoRenderer', 'compactVideoRenderer']) {
      const renderer = value[rendererKey];
      if (!isJsonObject(renderer)) continue;
      const videoId = typeof renderer.videoId === 'string' ? renderer.videoId.trim() : '';
      if (!videoId || seen.has(videoId)) continue;
      const title = rendererText(renderer.title) ?? 'YouTube video';
      seen.add(videoId);
      results.push({
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
        title,
        snippet: rendererText(renderer.descriptionSnippet),
        thumbnailUrl: rendererThumbnail(renderer.thumbnail),
        publishedAt: null,
      });
      if (results.length >= boundedLimit) return;
    }

    for (const child of Object.values(value)) {
      visit(child);
      if (results.length >= boundedLimit) return;
    }
  };

  visit(data);
  return results;
}

const toCandidate = (
  result: ParsedSearchResult,
  request: WebSearchRequest,
): RecommendationCandidate | null => {
  const externalId = extractYouTubeVideoId(result.url);
  if (!externalId) return null;
  const provenance: CandidateAcquisitionProvenance = {
    connector: 'youtube',
    mechanism: 'web_search',
    query: request.query,
    query_lane: request.lane,
    query_topics: [...request.topics],
    acquired_at: request.acquiredAt,
    graph_revision: request.graphRevision,
    source_url: result.url,
  };
  return {
    external_id: externalId,
    title: result.title.trim() || 'YouTube video',
    description: result.snippet?.trim() || null,
    thumbnail_url: result.thumbnailUrl?.trim() || null,
    published_at: result.publishedAt?.trim() || null,
    source_kind: 'discovery',
    provenance,
  };
};

export function createYoutubeSearchPageProvider(
  fetcher: typeof fetch = fetch,
): WebSearchProvider {
  return {
    id: 'youtube_search_page',
    async search(request) {
      const url = new URL('https://www.youtube.com/results');
      url.searchParams.set('search_query', request.query);

      const response = await fetcher(url.toString(), {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!response.ok) throw new Error(`YouTube search HTTP ${response.status}`);

      const seen = new Set<string>();
      return parseYoutubeSearchResultsHtml(await response.text(), request.limit)
        .flatMap((result): RecommendationCandidate[] => {
          const candidate = toCandidate(result, request);
          if (!candidate || seen.has(candidate.external_id)) return [];
          seen.add(candidate.external_id);
          return [candidate];
        });
    },
  };
}

const fetchWithTimeout = async (
  url: string,
  timeoutMs = 7000,
  fetcher: typeof fetch = fetch,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

export async function enrichYoutubeCandidate(
  candidate: ProviderEnrichmentInput,
  fetcher: typeof fetch = fetch,
): Promise<ProviderEnrichmentResult | null> {
  try {
    const response = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${encodeURIComponent(candidate.external_id)}`,
      7000,
      fetcher,
    );
    if (!response.ok) return null;
    const rich = extractYouTubeWatchMetadataFromHtml(await response.text());
    return {
      ...candidate,
      title: rich.title ?? candidate.title,
      channel_name: rich.channelName ?? candidate.channel_name ?? null,
      channel_id: rich.channelId ?? candidate.channel_id ?? null,
      thumbnail_url: rich.thumbnailUrl ?? candidate.thumbnail_url ?? null,
      description: rich.description?.slice(0, 1600) ?? candidate.description ?? null,
      duration_seconds: rich.durationSeconds ?? candidate.duration_seconds ?? null,
      published_at: rich.publishedAt ?? candidate.published_at ?? null,
      topics: [...new Set([...(candidate.topics ?? []), ...(rich.keywords ?? []), ...(rich.category ? [rich.category] : [])])].slice(0, 24),
      content_type: rich.category ?? candidate.content_type ?? null,
      is_short: candidate.is_short ?? false,
      is_live: candidate.is_live === true || rich.isLive,
      view_count: rich.viewCount,
    };
  } catch {
    return null;
  }
}

export const youtubeAcquisition: ProviderAcquisitionConnector = {
  search: createYoutubeSearchPageProvider(),
  enrich: enrichYoutubeCandidate,
};
