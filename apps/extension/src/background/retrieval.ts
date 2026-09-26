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

export function parseYoutubeSearchResultsHtml(
  html: string,
  limit = 20,
): WebSearchResult[] {
  const data = extractAssignedJson(html, [
    'var ytInitialData =',
    'ytInitialData =',
    'window["ytInitialData"] =',
  ]);
  if (!data) return [];

  const results: WebSearchResult[] = [];
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
      return parseYoutubeSearchResultsHtml(await response.text(), request.limit);
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
