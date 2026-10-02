import type {
  CandidateAcquisitionProvenance,
  RecommendationCandidate,
} from '@repo/shared-types';
import {
  extractYouTubeCaptionTracksFromHtml,
  extractYouTubeVideoId,
  extractYouTubeWatchMetadataFromHtml,
  type YouTubeCaptionTrack,
} from '../content-scripts/youtube-dom.ts';
import type {
  ProviderAcquisitionConnector,
  ProviderEnrichmentInput,
  ProviderEnrichmentOptions,
  ProviderEnrichmentResult,
  WebSearchProvider,
  WebSearchRequest,
} from './types';
import { ensureWorkerOffscreenDocument } from '../lib/offscreen-worker.ts';

export const MAX_RSS_CHANNELS_PER_REFRESH = 6;
export const MAX_RSS_ITEMS_PER_CHANNEL = 8;

export const YOUTUBE_SEARCH_BLOCKED_ERROR_CODE = 'YOUTUBE_SEARCH_BLOCKED';
export const MAX_YOUTUBE_TRANSCRIPT_CHARS = 2400;
export const isYoutubeVideoId = (value: string): boolean => /^[A-Za-z0-9_-]{11}$/.test(value.trim());

const INNERTUBE_PLAYER_ENDPOINT = 'https://www.youtube.com/youtubei/v1/player';
const INNERTUBE_TRANSCRIPT_CLIENTS = [
  {
    strategy: 'innertube_ios' as const,
    client: {
      hl: 'en',
      gl: 'GB',
      clientName: 'IOS',
      clientVersion: '19.45.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.1.0.22B83',
    },
  },
  {
    strategy: 'innertube_android' as const,
    client: {
      hl: 'en',
      gl: 'GB',
      clientName: 'ANDROID',
      clientVersion: '20.10.38',
      androidSdkVersion: 34,
    },
  },
] as const;

const normalizeTranscriptText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

export function boundYoutubeTranscriptText(
  value: string,
  maxChars = MAX_YOUTUBE_TRANSCRIPT_CHARS,
): string {
  const normalized = normalizeTranscriptText(value);
  const limit = Math.max(300, Math.min(6000, Math.floor(maxChars)));
  if (normalized.length <= limit) return normalized;

  const sliceSize = Math.max(100, Math.floor(limit / 3));
  const middleStart = Math.max(
    sliceSize,
    Math.floor((normalized.length - sliceSize) / 2),
  );
  const parts = [
    normalized.slice(0, sliceSize),
    normalized.slice(middleStart, middleStart + sliceSize),
    normalized.slice(-sliceSize),
  ].map((part) => part.trim()).filter(Boolean);
  return parts.join(' … ').slice(0, limit);
}

const decodeCaptionText = (value: string): string => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_match, code) => {
    const value = Number(code);
    return Number.isInteger(value) && value > 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : ' ';
  });

export function parseYoutubeTranscriptPayload(payload: string): string {
  const trimmed = payload.trim();
  if (!trimmed) return '';

  try {
    const parsed = JSON.parse(trimmed) as {
      events?: Array<{ segs?: Array<{ utf8?: string }> }>;
    };
    if (Array.isArray(parsed.events)) {
      const text = parsed.events
        .flatMap((event) => Array.isArray(event.segs) ? event.segs : [])
        .map((segment) => typeof segment.utf8 === 'string' ? segment.utf8 : '')
        .join(' ');
      return boundYoutubeTranscriptText(decodeCaptionText(text));
    }
  } catch {
    // Fall through to the legacy timed-text XML representation.
  }

  const text = [...trimmed.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((match) => decodeCaptionText(match[1] ?? ''))
    .join(' ');
  return boundYoutubeTranscriptText(text);
}

export function extractYoutubeInnertubeApiKey(html: string): string | null {
  const patterns = [
    /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/,
    /INNERTUBE_API_KEY\s*[:=]\s*["']([^"']+)["']/,
  ];
  for (const pattern of patterns) {
    const value = html.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return null;
}

const captionTrackNameFromPlayer = (value: unknown): string | null => {
  if (!isJsonObject(value)) return null;
  if (typeof value.simpleText === 'string') return normalizeTranscriptText(value.simpleText) || null;
  if (!Array.isArray(value.runs)) return null;
  const text = value.runs
    .map((run) => isJsonObject(run) && typeof run.text === 'string' ? run.text : '')
    .join('');
  return normalizeTranscriptText(text) || null;
};

export function extractYoutubeCaptionTracksFromPlayerResponse(
  player: unknown,
): YouTubeCaptionTrack[] {
  if (!isJsonObject(player)) return [];
  const captions = player.captions;
  if (!isJsonObject(captions)) return [];
  const renderer = captions.playerCaptionsTracklistRenderer;
  if (!isJsonObject(renderer) || !Array.isArray(renderer.captionTracks)) return [];

  const seen = new Set<string>();
  return renderer.captionTracks.flatMap((value): YouTubeCaptionTrack[] => {
    if (!isJsonObject(value)) return [];
    const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : '';
    const languageCode = typeof value.languageCode === 'string' ? value.languageCode.trim() : '';
    if (!baseUrl || !languageCode) return [];
    const key = `${languageCode}:${baseUrl}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const kind = typeof value.kind === 'string' ? value.kind.trim() || null : null;
    return [{
      baseUrl,
      languageCode,
      name: captionTrackNameFromPlayer(value.name),
      kind,
      autoGenerated: kind === 'asr',
    }];
  });
}

export function selectYoutubeCaptionTrack(
  tracks: readonly YouTubeCaptionTrack[],
  preferredLanguage = 'en',
): YouTubeCaptionTrack | null {
  const language = preferredLanguage.trim().toLowerCase();
  const eligible = tracks
    .filter((track) => track.languageCode.toLowerCase().startsWith(language))
    .sort((left, right) => (
      Number(left.autoGenerated) - Number(right.autoGenerated)
      || left.languageCode.localeCompare(right.languageCode)
      || (left.name ?? '').localeCompare(right.name ?? '')
    ));
  return eligible[0] ?? null;
}

const normalizeYoutubeCaptionUrl = (baseUrl: string): string | null => {
  try {
    const url = new URL(baseUrl);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return null;
    if (host !== 'youtube.com' && !host.endsWith('.youtube.com')) return null;
    if (url.pathname !== '/api/timedtext') return null;
    url.searchParams.set('fmt', 'json3');
    return url.toString();
  } catch {
    return null;
  }
};

async function fetchYoutubeCaptionTranscript(
  track: YouTubeCaptionTrack,
  fetcher: typeof fetch,
): Promise<string> {
  const url = normalizeYoutubeCaptionUrl(track.baseUrl);
  if (!url) return '';
  const response = await fetchWithTimeout(url, 5000, fetcher);
  if (!response.ok) return '';
  return parseYoutubeTranscriptPayload(await response.text());
}


export function isYoutubeSearchBlockedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes(YOUTUBE_SEARCH_BLOCKED_ERROR_CODE);
}

const assertYoutubeSearchResponse = (response: Response): void => {
  // Production search requests must never follow YouTube's anti-abuse redirect
  // into google.com/sorry. Following it creates a cross-origin CORS error in the
  // extension console and a second retry only increases request pressure.
  if (
    response.type === 'opaqueredirect'
    || (response.status >= 300 && response.status < 400)
  ) {
    throw new Error(
      `${YOUTUBE_SEARCH_BLOCKED_ERROR_CODE}: YouTube search redirected to an anti-abuse/interstitial response.`,
    );
  }

  if (response.url) {
    try {
      const host = new URL(response.url).hostname.toLowerCase();
      if (host !== 'www.youtube.com' && host !== 'youtube.com') {
        throw new Error(
          `${YOUTUBE_SEARCH_BLOCKED_ERROR_CODE}: YouTube search left the YouTube origin (${host}).`,
        );
      }
    } catch (error) {
      if (isYoutubeSearchBlockedError(error)) throw error;
    }
  }
};

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

async function searchYoutubePageOffThread(
  request: WebSearchRequest,
): Promise<ParsedSearchResult[] | null> {
  let ready = false;
  try {
    ready = await ensureWorkerOffscreenDocument(
      'Run YouTube search-page parsing in a dedicated worker so ranking UI remains responsive.',
    );
  } catch (error) {
    console.warn('[MyAlgo] offscreen YouTube search unavailable; service-worker fallback allowed', error);
    return null;
  }
  if (!ready) return null;

  // Once the offscreen provider is available, a provider/network failure is
  // terminal for this search attempt. Do not immediately repeat the same query
  // from the service worker, especially after an anti-abuse response.
  const response = await chrome.runtime.sendMessage({
    target: 'youtube-search-offscreen',
    type: 'SEARCH_YOUTUBE_PAGE',
    query: request.query,
    limit: request.limit,
  }) as { ok?: boolean; results?: ParsedSearchResult[]; error?: string };
  if (!response?.ok) throw new Error(response?.error ?? 'YouTube search worker failed.');
  return Array.isArray(response.results) ? response.results : [];
}

export function createYoutubeSearchPageProvider(
  fetcher?: typeof fetch,
): WebSearchProvider {
  return {
    id: 'youtube_search_page',
    async search(request) {
      let parsed: ParsedSearchResult[] | null = null;

      // Production uses an offscreen document + dedicated Worker so large
      // YouTube result pages never block the extension service worker that
      // handles ranking/UI messages. Tests and unsupported browsers use the
      // injected/direct fetch fallback.
      if (!fetcher) {
        parsed = await searchYoutubePageOffThread(request);
      }

      if (parsed == null) {
        const directFetch = fetcher ?? fetch;
        const url = new URL('https://www.youtube.com/results');
        url.searchParams.set('search_query', request.query);

        const response = await directFetch(url.toString(), {
          method: 'GET',
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'manual',
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        assertYoutubeSearchResponse(response);
        if (!response.ok) throw new Error(`YouTube search HTTP ${response.status}`);
        parsed = parseYoutubeSearchResultsHtml(await response.text(), request.limit);
      }

      const seen = new Set<string>();
      return parsed.flatMap((result): RecommendationCandidate[] => {
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
  init: RequestInit = {},
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, {
      method: init.method ?? 'GET',
      credentials: init.credentials ?? 'omit',
      cache: init.cache ?? 'no-store',
      redirect: init.redirect ?? 'manual',
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

async function fetchInnertubeCaptionTracks(
  videoId: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<Array<{
  strategy: 'innertube_ios' | 'innertube_android';
  tracks: YouTubeCaptionTrack[];
}>> {
  const results: Array<{
    strategy: 'innertube_ios' | 'innertube_android';
    tracks: YouTubeCaptionTrack[];
  }> = [];
  for (const client of INNERTUBE_TRANSCRIPT_CLIENTS) {
    try {
      const url = new URL(INNERTUBE_PLAYER_ENDPOINT);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('prettyPrint', 'false');
      const response = await fetchWithTimeout(url.toString(), 5000, fetcher, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': 'en-GB,en;q=0.9',
        },
        body: JSON.stringify({
          context: { client: client.client },
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
      });
      if (!response.ok) continue;
      const tracks = extractYoutubeCaptionTracksFromPlayerResponse(await response.json());
      results.push({ strategy: client.strategy, tracks });
    } catch {
      // Try the next non-WEB client. Caption enrichment is optional.
    }
  }
  return results;
}

export async function enrichYoutubeCandidate(
  candidate: ProviderEnrichmentInput,
  fetcher: typeof fetch = fetch,
  options: ProviderEnrichmentOptions = {},
): Promise<ProviderEnrichmentResult | null> {
  const videoId = candidate.external_id.trim();
  if (!isYoutubeVideoId(videoId)) {
    return {
      ...candidate,
      transcript: null,
      transcript_diagnostics: options.includeTranscript === true
        ? {
            attempted: false,
            strategy: null,
            reason: 'invalid_video_id',
          }
        : null,
    };
  }

  try {
    const response = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      7000,
      fetcher,
    );
    if (!response.ok) return null;
    const html = await response.text();
    const rich = extractYouTubeWatchMetadataFromHtml(html);

    let transcript: ProviderEnrichmentResult['transcript'] = null;
    let transcriptDiagnostics: ProviderEnrichmentResult['transcript_diagnostics'] = null;

    if (options.includeTranscript === true && !rich.isLive) {
      const apiKey = extractYoutubeInnertubeApiKey(html);
      let sawEnglishTrack = false;
      let sawCaptionRequestFailure = false;
      let sawEmptyCaptionPayload = false;

      if (apiKey) {
        const innerTubeResults = await fetchInnertubeCaptionTracks(videoId, apiKey, fetcher);
        for (const result of innerTubeResults) {
          const track = selectYoutubeCaptionTrack(result.tracks);
          if (!track) continue;
          sawEnglishTrack = true;
          try {
            const text = await fetchYoutubeCaptionTranscript(track, fetcher);
            if (text) {
              transcript = {
                text,
                language: track.languageCode,
                source: 'youtube_caption_track',
                auto_generated: track.autoGenerated,
                acquisition_strategy: result.strategy,
              };
              transcriptDiagnostics = {
                attempted: true,
                strategy: result.strategy,
                reason: 'available',
              };
              break;
            }
            sawEmptyCaptionPayload = true;
          } catch {
            sawCaptionRequestFailure = true;
          }
        }
      }

      // The WEB/watch-page URL is retained only as a last-resort fallback for
      // videos not currently PoToken-gated. Current YouTube commonly returns an
      // empty 200 body here, so do not prefer it over non-WEB InnerTube clients.
      if (!transcript) {
        const track = selectYoutubeCaptionTrack(extractYouTubeCaptionTracksFromHtml(html));
        if (track) {
          sawEnglishTrack = true;
          try {
            const text = await fetchYoutubeCaptionTranscript(track, fetcher);
            if (text) {
              transcript = {
                text,
                language: track.languageCode,
                source: 'youtube_caption_track',
                auto_generated: track.autoGenerated,
                acquisition_strategy: 'watch_page',
              };
              transcriptDiagnostics = {
                attempted: true,
                strategy: 'watch_page',
                reason: 'available',
              };
            } else {
              sawEmptyCaptionPayload = true;
            }
          } catch {
            sawCaptionRequestFailure = true;
          }
        }
      }

      if (!transcriptDiagnostics) {
        transcriptDiagnostics = {
          attempted: true,
          strategy: null,
          reason: !apiKey
            ? 'missing_innertube_api_key'
            : !sawEnglishTrack
              ? 'no_english_caption_track'
              : sawEmptyCaptionPayload
                ? 'caption_payload_empty'
                : sawCaptionRequestFailure
                  ? 'caption_request_failed'
                  : 'player_request_failed',
        };
      }
    }

    return {
      ...candidate,
      external_id: videoId,
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
      transcript,
      transcript_diagnostics: transcriptDiagnostics,
    };
  } catch {
    return null;
  }
}

export const youtubeAcquisition: ProviderAcquisitionConnector = {
  search: createYoutubeSearchPageProvider(),
  enrich: (candidate, options) => enrichYoutubeCandidate(candidate, fetch, options),
};
