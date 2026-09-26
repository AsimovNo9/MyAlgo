import type { CandidateAcquisitionProvenance, RecommendationCandidate, RecommendationQueryPlan } from '@repo/shared-types';

export const RSS_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
export const MAX_RSS_CHANNELS_PER_REFRESH = 6;
export const MAX_RSS_ITEMS_PER_CHANNEL = 8;


export type WebSearchRequest = {
  query: string;
  lane: RecommendationQueryPlan['lane'];
  topics: string[];
  graphRevision: string;
  limit: number;
};

export type WebSearchResult = {
  url: string;
  title: string;
  snippet?: string | null;
  publishedAt?: string | null;
  thumbnailUrl?: string | null;
};

function youtubeVideoIdFromUrl(urlValue: string): string | null {
  try {
    const url = new URL(urlValue, 'https://www.youtube.com');
    const host = url.hostname.toLowerCase();
    const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
    if (!isYouTube) return null;
    const queryId = url.searchParams.get('v');
    if (queryId && url.pathname === '/watch') return queryId;
    if (host === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
    return url.pathname.match(/\/(?:shorts|live|embed)\/([^/?]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function normalizeWebSearchResultsToYoutubeCandidates(
  results: WebSearchResult[],
  plan: RecommendationQueryPlan,
  acquiredAt: string,
): RecommendationCandidate[] {
  const seen = new Set<string>();
  const candidates: RecommendationCandidate[] = [];

  for (const result of results) {
    const externalId = youtubeVideoIdFromUrl(result.url);
    if (!externalId || seen.has(externalId)) continue;
    seen.add(externalId);
    candidates.push({
      external_id: externalId,
      title: result.title?.trim() || 'YouTube video',
      description: result.snippet?.trim() || null,
      thumbnail_url: result.thumbnailUrl?.trim() || null,
      published_at: result.publishedAt?.trim() || null,
      source_kind: 'discovery',
      provenance: {
        connector: 'youtube',
        mechanism: 'web_search',
        query: plan.text,
        query_lane: plan.lane,
        query_topics: [...plan.topics],
        acquired_at: acquiredAt,
        graph_revision: plan.algorithmRevision,
        source_url: result.url,
      },
    });
  }

  return candidates;
}

export function normalizeWebSearchEndpoint(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    url.pathname = url.pathname.replace(/\/$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function webSearchOriginPattern(value: string | null | undefined): string | null {
  const endpoint = normalizeWebSearchEndpoint(value);
  if (!endpoint) return null;
  const url = new URL(endpoint);
  return `${url.origin}/*`;
}

export function createSearxngWebSearchProvider(
  endpointValue: string,
  fetcher: typeof fetch = fetch,
): WebSearchProvider {
  const endpoint = normalizeWebSearchEndpoint(endpointValue);
  if (!endpoint) throw new Error('Web-search endpoint must be an HTTPS SearXNG base URL.');

  return {
    id: 'searxng',
    async search(request) {
      const url = new URL(`${endpoint}/search`);
      url.searchParams.set('q', `${request.query} site:youtube.com/watch`);
      url.searchParams.set('format', 'json');
      url.searchParams.set('categories', 'general');
      url.searchParams.set('language', 'auto');

      const response = await fetcher(url.toString(), {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Web search HTTP ${response.status}`);
      const payload = await response.json() as {
        results?: Array<{
          url?: unknown;
          title?: unknown;
          content?: unknown;
          publishedDate?: unknown;
          thumbnail?: unknown;
        }>;
      };

      return (payload.results ?? [])
        .flatMap((item): WebSearchResult[] => {
          if (typeof item.url !== 'string' || typeof item.title !== 'string') return [];
          return [{
            url: item.url,
            title: item.title,
            snippet: typeof item.content === 'string' ? item.content : null,
            publishedAt: typeof item.publishedDate === 'string' ? item.publishedDate : null,
            thumbnailUrl: typeof item.thumbnail === 'string' ? item.thumbnail : null,
          }];
        })
        .slice(0, request.limit);
    },
  };
}

export interface WebSearchProvider {
  readonly id: string;
  search(request: WebSearchRequest): Promise<WebSearchResult[]>;
}

export async function acquireWebSearchCandidates(
  provider: WebSearchProvider,
  plans: RecommendationQueryPlan[],
  acquiredAt: string,
  maxPlans = 4,
  perPlanLimit = 8,
): Promise<RecommendationCandidate[]> {
  const selectedPlans = plans.slice(0, Math.max(0, maxPlans));
  const batches = await Promise.all(selectedPlans.map(async (plan) => {
    const results = await provider.search(buildWebSearchRequest(plan, perPlanLimit));
    return normalizeWebSearchResultsToYoutubeCandidates(results, plan, acquiredAt);
  }));

  const byId = new Map<string, RecommendationCandidate>();
  for (const candidate of batches.flat()) {
    if (!byId.has(candidate.external_id)) byId.set(candidate.external_id, candidate);
  }
  return [...byId.values()];
}

export function buildWebSearchRequest(
  plan: RecommendationQueryPlan,
  limit = 8,
): WebSearchRequest {
  return {
    query: plan.text,
    lane: plan.lane,
    topics: [...plan.topics],
    graphRevision: plan.algorithmRevision,
    limit: Math.max(1, Math.min(20, Math.floor(limit))),
  };
}

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

export function mergeCandidateAcquisitionHistory(
  existing: CandidateAcquisitionProvenance[] | undefined,
  incoming: CandidateAcquisitionProvenance,
  limit = 12,
): CandidateAcquisitionProvenance[] {
  const key = (item: CandidateAcquisitionProvenance) => JSON.stringify([
    item.connector,
    item.mechanism,
    item.query ?? null,
    item.query_lane ?? null,
    item.graph_revision ?? null,
    item.source_url ?? null,
  ]);
  const byKey = new Map<string, CandidateAcquisitionProvenance>();
  for (const item of [...(existing ?? []), incoming]) {
    const identity = key(item);
    const previous = byKey.get(identity);
    if (!previous || previous.acquired_at.localeCompare(item.acquired_at) < 0) {
      byKey.set(identity, item);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => right.acquired_at.localeCompare(left.acquired_at))
    .slice(0, Math.max(1, limit));
}

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

export function shouldRefreshObservedCandidate(
  lastSeenAt: string | null | undefined,
  nowMs: number,
  intervalMs = 30_000,
): boolean {
  const previous = new Date(lastSeenAt ?? 0).getTime();
  return !Number.isFinite(previous) || nowMs - previous >= Math.max(0, intervalMs);
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

export const WEB_SEARCH_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export function nextWebSearchAllowedAt(
  nowMs: number,
  consecutiveFailures: number,
): string {
  if (consecutiveFailures <= 0) {
    return new Date(nowMs + WEB_SEARCH_REFRESH_INTERVAL_MS).toISOString();
  }
  const backoff = Math.min(
    60 * 60 * 1000,
    2 * 60 * 1000 * (2 ** Math.min(4, consecutiveFailures - 1)),
  );
  return new Date(nowMs + backoff).toISOString();
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
