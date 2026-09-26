import { createMessage, EXTENSION_MESSAGE_TYPES } from '../lib/messaging';
import { STORAGE_KEYS, getStorage, setStorage } from '../lib/storage';
import type { CandidateAcquisitionProvenance, FeedSourceFilters, RetrievalDiagnostics, RetrievalSettings } from '@repo/shared-types';
import { youtubeConnector } from '../connectors/youtube';
import { createHistoryEvidenceId, mergeHistoryEvidence, type HistoryEvidence, type HistoryObservationMetrics } from '../content-scripts/youtube-history';
import { mergeRecommendationObservations, type RecommendationObservation, type RecommendationObservationMetrics } from '../content-scripts/youtube-recommendations';
import type { SelectionObservation, UserBehaviorObservation } from '../content-scripts/youtube-interactions';
import type { TemporalWatchObservation } from '../content-scripts/youtube-watch';
import { correlateBehavior, getBehaviorForVideo } from '../content-scripts/behavior-correlation';
import { toNormalizedInteraction } from '../content-scripts/youtube-interactions';
import { toNormalizedExposure } from '../content-scripts/youtube-recommendations';
import { createChromeLocalStateStorage, LocalPersonalAlgorithmStore } from '../lib/personal-algorithm-store';
import { buildLocalFeedbackSignals, scoreLocalCandidates } from './personal-algorithm-runtime';
import { applyModeToRetrievalProfile, buildGraphRetrievalProfile, buildGraphRetrievalRevision, buildRecommendationQueryPlans } from '@repo/recommender-core';
import { PRIVACY_DISCLOSURE_VERSION, isPrivacyDisclosureAccepted } from '../lib/privacy';
import { acquireWebSearchCandidates, buildYoutubeRssFeedUrl, createSearxngWebSearchProvider, isRetrievalAllowed, mergeCandidateAcquisitionHistory, needsYoutubeMetadataRefresh, nextRssAllowedAt, nextWebSearchAllowedAt, normalizeWebSearchEndpoint, parseYoutubeRssFeed, webSearchOriginPattern, selectRssChannelIds, shouldRefreshObservedCandidate } from './retrieval';
import { extractYouTubeWatchMetadataFromHtml } from '../content-scripts/youtube-dom';

type PageCandidate = {
  external_id: string;
  title: string;
  channel_name?: string | null;
  channel_id?: string | null;
  thumbnail_url?: string | null;
  source_kind?: 'subscription' | 'discovery' | 'liked' | null;
  published_at?: string | null;
  description?: string | null;
  duration_seconds?: number | null;
  topics?: string[];
  content_type?: string | null;
  provenance?: CandidateAcquisitionProvenance;
  acquisition_history?: CandidateAcquisitionProvenance[];
  is_short?: boolean;
  is_live?: boolean;
};

type VideoRecord = PageCandidate & {
  channel_id?: string | null;
  description?: string | null;
  duration_seconds?: number | null;
  published_at?: string | null;
  view_count?: number | null;
  enrichedAt: string;
};

type CandidatePoolItem = PageCandidate & {
  firstSeenAt: string;
  lastSeenAt: string;
  lastAcquiredAt?: string;
};

type LocalFeedItem = CandidatePoolItem & {
  id: string;
  rawScore: number;
  score: number;
  visible: boolean;
  suppressed: boolean;
  policyOutcome: 'eligible' | 'ineligible' | 'excluded' | 'suppressed';
  source_kind: 'subscription' | 'discovery' | 'liked' | null;
  traceId: string;
  explanation?: {
    rawScore: number;
    displayScore: number;
    graphRevision: number;
    acquisitionMechanism: string | null;
    contributions: Array<{ label: string; value: number; kind: string }>;
  };
};

const MAX_CANDIDATE_POOL_SIZE = 1500;
const MAX_HISTORY_EVIDENCE = 10000;
const MAX_FEED_CACHE_SIZE = 80;
const MAX_VIDEO_STORE_SIZE = 800;
const MAX_METADATA_ENRICHMENTS_PER_SCAN = 6;
const MAX_SELECTION_EVENTS = 2000;
const METADATA_REFRESH_MS = 24 * 60 * 60 * 1000;
const OBSERVED_CANDIDATE_REFRESH_MS = 30_000;
const MAX_RANK_WORKING_SET = 320;
const MAX_REPLACEMENT_WORKING_SET = 180;
const DEFAULT_RETRIEVAL_SETTINGS: RetrievalSettings = {
  rssEnabled: false,
  webSearchEnabled: false,
  webSearchEndpoint: null,
};
const EMPTY_RETRIEVAL_DIAGNOSTICS: RetrievalDiagnostics = {
  lastRssSyncAt: null,
  nextRssAllowedAt: null,
  rssChannelsConsidered: 0,
  rssFeedsSucceeded: 0,
  rssFeedsFailed: 0,
  rssCandidatesFetched: 0,
  rssCandidatesAdded: 0,
  rssCandidatesDeduplicated: 0,
  rssConsecutiveFailures: 0,
  lastWebSearchAt: null,
  nextWebSearchAllowedAt: null,
  webSearchPlansAttempted: 0,
  webSearchPlansSucceeded: 0,
  webSearchCandidatesFetched: 0,
  webSearchCandidatesAdded: 0,
  webSearchCandidatesDeduplicated: 0,
  webSearchConsecutiveFailures: 0,
  lastError: null,
};
const personalAlgorithmStore = new LocalPersonalAlgorithmStore(createChromeLocalStateStorage());
let historyReconciliationReady: Promise<void> | null = null;
let privacyDisclosureAccepted = false;
let privacyDisclosureReady: Promise<boolean> | null = null;
let lastPersistedTraceSignature = '';
const metadataEnrichmentInFlight = new Set<string>();

const ensurePrivacyDisclosureLoaded = (): Promise<boolean> => {
  if (privacyDisclosureReady) return privacyDisclosureReady;
  privacyDisclosureReady = getStorage<unknown>(
    STORAGE_KEYS.PRIVACY_DISCLOSURE_ACCEPTED_VERSION,
    null,
  ).then((value) => {
    privacyDisclosureAccepted = isPrivacyDisclosureAccepted(value);
    return privacyDisclosureAccepted;
  }).catch((error) => {
    privacyDisclosureReady = null;
    console.warn('[MyAlgo] privacy disclosure state load failed', error);
    return false;
  });
  return privacyDisclosureReady;
};

void ensurePrivacyDisclosureLoaded();

const PRIVACY_GATED_MESSAGE_TYPES = new Set<string>([
  'RANK_PAGE',
  'SET_RETRIEVAL_SETTINGS',
  'REFRESH_RETRIEVAL',
  'GET_RETRIEVAL_PLAN',
  EXTENSION_MESSAGE_TYPES.ACTIVITY,
  EXTENSION_MESSAGE_TYPES.FEEDBACK,
  EXTENSION_MESSAGE_TYPES.HISTORY_OBSERVATION,
  EXTENSION_MESSAGE_TYPES.RECOMMENDATION_OBSERVATION,
  EXTENSION_MESSAGE_TYPES.SELECTION_OBSERVATION,
  EXTENSION_MESSAGE_TYPES.WATCH_OBSERVATION,
]);

async function persistNormalizedEvidence(
  evidence: Parameters<LocalPersonalAlgorithmStore['upsertEvidence']>[0]['evidence'],
  id: string,
): Promise<void> {
  await personalAlgorithmStore.upsertEvidence({ evidence, confidence: 1 }, id);
}

async function reconcileStoredHistoryEvidence(): Promise<void> {
  const startedAt = performance.now();
  console.info('[MyAlgo] history reconciliation started');
  const historyEvidence = await getStorage<HistoryEvidence[]>(STORAGE_KEYS.HISTORY_EVIDENCE, []);
  console.info('[MyAlgo] history reconciliation raw evidence loaded', {
    historyCount: historyEvidence.length,
  });
  const normalizedInputs = historyEvidence.map((item) => ({
    id: createHistoryEvidenceId(item.externalId),
    evidence: toNormalizedInteraction({
      videoId: item.externalId,
      exposureId: null,
      title: item.title,
      creator: item.creator,
      historyTimestamp: item.historyTimestamp,
      kind: 'watched',
      source: 'history',
      observedAt: item.observedAt,
      provenance: 'youtube_history_dom',
    }),
    confidence: 1,
  }));

  const result = await personalAlgorithmStore.reconcileHistoryEvidence(normalizedInputs);
  console.info('[MyAlgo] history reconciliation complete', {
    removed: result.removed,
    upserted: result.upserted,
    elapsedMs: Math.round(performance.now() - startedAt),
  });
}

async function enrichVideos(candidates: PageCandidate[]): Promise<VideoRecord[]> {
  if (candidates.length === 0) return [];
  const existing = await getStorage<Record<string, VideoRecord>>(STORAGE_KEYS.VIDEO_STORE, {});
  const now = Date.now();
  const missing = candidates
    .filter((candidate) => {
      const record = existing[candidate.external_id];
      return needsYoutubeMetadataRefresh(record, now, METADATA_REFRESH_MS)
        && !metadataEnrichmentInFlight.has(candidate.external_id);
    })
    .slice(0, MAX_METADATA_ENRICHMENTS_PER_SCAN);
  if (missing.length === 0) return [];
  missing.forEach((candidate) => metadataEnrichmentInFlight.add(candidate.external_id));

  const enrichOne = async (candidate: PageCandidate): Promise<VideoRecord | null> => {
    try {
      const response = await fetchWithTimeout(youtubeConnector.getCanonicalUrl(candidate.external_id), 7000);
      if (!response.ok) return null;
      const html = await response.text();
      const rich = extractYouTubeWatchMetadataFromHtml(html);
      return {
        ...candidate,
        title: rich.title ?? candidate.title,
        channel_name: rich.channelName ?? candidate.channel_name ?? null,
        channel_id: rich.channelId ?? candidate.channel_id ?? null,
        thumbnail_url: rich.thumbnailUrl ?? candidate.thumbnail_url ?? null,
        description: rich.description?.slice(0, 1600) ?? null,
        duration_seconds: rich.durationSeconds,
        published_at: rich.publishedAt ?? candidate.published_at ?? null,
        topics: [...new Set([...(rich.keywords ?? []), ...(rich.category ? [rich.category] : [])])].slice(0, 24),
        content_type: rich.category ?? null,
        is_live: candidate.is_live === true || rich.isLive,
        view_count: rich.viewCount,
        enrichedAt: new Date().toISOString(),
      } satisfies VideoRecord;
    } catch {
      return null;
    }
  };

  try {
    const enrichedResults: Array<VideoRecord | null> = [];
    for (let index = 0; index < missing.length; index += 2) {
      enrichedResults.push(...await Promise.all(missing.slice(index, index + 2).map(enrichOne)));
    }
    const enriched = enrichedResults.filter((record): record is VideoRecord => record !== null);

    if (enriched.length === 0) return [];
    for (const record of enriched) existing[record.external_id] = record;
    const entries = Object.entries(existing)
      .sort(([, a], [, b]) => new Date(b.enrichedAt).getTime() - new Date(a.enrichedAt).getTime())
      .slice(0, MAX_VIDEO_STORE_SIZE);
    await setStorage(STORAGE_KEYS.VIDEO_STORE, Object.fromEntries(entries));
    return enriched;
  } finally {
    missing.forEach((candidate) => metadataEnrichmentInFlight.delete(candidate.external_id));
  }
}

async function hydrateCandidatePool(pool: CandidatePoolItem[]): Promise<CandidatePoolItem[]> {
  const store = await getStorage<Record<string, VideoRecord>>(STORAGE_KEYS.VIDEO_STORE, {});
  return pool.map((candidate) => {
    const record = store[candidate.external_id];
    if (!record) return candidate;
    return { ...candidate, ...record, external_id: candidate.external_id, title: record.title || candidate.title };
  });
}

async function mergeCandidatePool(candidates: PageCandidate[]): Promise<CandidatePoolItem[]> {
  const existing = await getStorage<CandidatePoolItem[]>(
    STORAGE_KEYS.FEED_CANDIDATE_POOL,
    [],
  );

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const byId = new Map<string, CandidatePoolItem>(
    existing.map((candidate) => [candidate.external_id, candidate]),
  );
  let changed = false;

  const materialSignature = (candidate: PageCandidate | CandidatePoolItem) => JSON.stringify({
    title: candidate.title,
    channel_name: candidate.channel_name ?? null,
    channel_id: candidate.channel_id ?? null,
    thumbnail_url: candidate.thumbnail_url ?? null,
    description: candidate.description ?? null,
    duration_seconds: candidate.duration_seconds ?? null,
    published_at: candidate.published_at ?? null,
    topics: candidate.topics ?? [],
    content_type: candidate.content_type ?? null,
    source_kind: candidate.source_kind ?? null,
    is_short: candidate.is_short ?? false,
    is_live: candidate.is_live ?? false,
  });

  for (const candidate of candidates) {
    if (!candidate.external_id || !candidate.title) continue;

    const previous = byId.get(candidate.external_id);
    const incomingProvenance = candidate.provenance ?? {
      connector: 'youtube',
      mechanism: 'observed_dom' as const,
      acquired_at: now,
      graph_revision: null,
      source_url: null,
    };
    const observedNow = incomingProvenance.mechanism === 'observed_dom';
    const materialChanged = !previous || materialSignature(previous) !== materialSignature(candidate);
    const refreshObservation = observedNow
      ? shouldRefreshObservedCandidate(previous?.lastSeenAt, nowMs, OBSERVED_CANDIDATE_REFRESH_MS)
      : true;

    if (previous && observedNow && !materialChanged && !refreshObservation) {
      continue;
    }

    const acquisitionHistory = observedNow && previous
      ? previous.acquisition_history
        ?? (previous.provenance ? [previous.provenance] : undefined)
      : mergeCandidateAcquisitionHistory(
          previous?.acquisition_history
            ?? (previous?.provenance ? [previous.provenance] : undefined),
          incomingProvenance,
        );

    byId.set(candidate.external_id, {
      ...previous,
      ...candidate,
      provenance: previous?.provenance ?? incomingProvenance,
      acquisition_history: acquisitionHistory,
      external_id: candidate.external_id,
      title: candidate.title,
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: observedNow ? (refreshObservation ? now : previous?.lastSeenAt ?? now) : previous?.lastSeenAt ?? now,
      lastAcquiredAt: observedNow ? previous?.lastAcquiredAt ?? incomingProvenance.acquired_at : incomingProvenance.acquired_at,
    });
    changed = true;
  }

  const pool = [...byId.values()]
    .sort(
      (a, b) =>
        new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
    )
    .slice(0, MAX_CANDIDATE_POOL_SIZE);

  if (pool.length !== existing.length) changed = true;
  if (changed) {
    await setStorage(STORAGE_KEYS.FEED_CANDIDATE_POOL, pool);
  }
  return pool;
}

const fetchWithTimeout = async (url: string, timeoutMs = 5000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

async function refreshRssCandidates(force = false): Promise<{ diagnostics: RetrievalDiagnostics; changed: boolean }> {
  const settings = await getStorage<RetrievalSettings>(
    STORAGE_KEYS.RETRIEVAL_SETTINGS,
    DEFAULT_RETRIEVAL_SETTINGS,
  );
  const previous = await getStorage<RetrievalDiagnostics>(
    STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS,
    EMPTY_RETRIEVAL_DIAGNOSTICS,
  );
  const nowMs = Date.now();

  if (!settings.rssEnabled) return { diagnostics: previous, changed: false };
  if (!force && !isRetrievalAllowed(previous.nextRssAllowedAt, nowMs)) {
    return { diagnostics: previous, changed: false };
  }

  let store = await getStorage<Record<string, VideoRecord>>(STORAGE_KEYS.VIDEO_STORE, {});
  let channelIds = selectRssChannelIds(Object.values(store));

  // Older cached metadata can be fresh but lack channel IDs. Seed channel IDs
  // directly in the extension worker from the bounded candidate reservoir.
  if (channelIds.length === 0) {
    const candidatePool = await getStorage<CandidatePoolItem[]>(STORAGE_KEYS.FEED_CANDIDATE_POOL, []);
    if (candidatePool.length > 0) {
      await enrichVideos(candidatePool);
      store = await getStorage<Record<string, VideoRecord>>(STORAGE_KEYS.VIDEO_STORE, {});
      channelIds = selectRssChannelIds(Object.values(store));
    }
  }

  if (channelIds.length === 0) {
    const diagnostics: RetrievalDiagnostics = {
      ...EMPTY_RETRIEVAL_DIAGNOSTICS,
      lastRssSyncAt: new Date(nowMs).toISOString(),
      nextRssAllowedAt: null,
      lastError: 'No YouTube channel IDs are available yet. Refresh discovery after MyAlgo has observed a few videos.',
    };
    await setStorage(STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS, diagnostics);
    return { diagnostics, changed: false };
  }

  const existingPool = await getStorage<CandidatePoolItem[]>(STORAGE_KEYS.FEED_CANDIDATE_POOL, []);
  const existingIds = new Set(existingPool.map((item) => item.external_id));
  const acquiredAt = new Date(nowMs).toISOString();
  const state = await personalAlgorithmStore.exportState();
  const graphRevision = buildGraphRetrievalRevision(state);

  const results = await Promise.all(channelIds.map(async (channelId) => {
    const sourceUrl = buildYoutubeRssFeedUrl(channelId);
    try {
      const response = await fetchWithTimeout(sourceUrl);
      if (!response.ok) throw new Error(`RSS HTTP ${response.status}`);
      const xml = await response.text();
      return {
        ok: true as const,
        candidates: parseYoutubeRssFeed(xml, acquiredAt, sourceUrl).map((candidate) => ({
          ...candidate,
          provenance: candidate.provenance
            ? { ...candidate.provenance, graph_revision: graphRevision }
            : undefined,
        })),
      };
    } catch {
      return { ok: false as const, candidates: [] };
    }
  }));

  const fetched = results.flatMap((result) => result.candidates);
  const uniqueFetched = [...new Map(fetched.map((item) => [item.external_id, item])).values()];
  const addedCount = uniqueFetched.filter((item) => !existingIds.has(item.external_id)).length;
  if (uniqueFetched.length > 0) {
    await mergeCandidatePool(uniqueFetched);

    // RSS is intentionally lightweight. Before the new candidates are ranked,
    // enrich a bounded batch from their canonical watch pages through an open
    // YouTube tab. This gives the local scorer/title UI substantially richer
    // metadata without introducing a native yt-dlp binary, backend, API key, or
    // YouTube Data API dependency.
    await enrichVideos(uniqueFetched.slice(0, 18));
  }

  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;
  const consecutiveFailures = results.length > 0 && succeeded === 0
    ? (previous.rssConsecutiveFailures ?? 0) + 1
    : 0;
  const diagnostics: RetrievalDiagnostics = {
    lastRssSyncAt: acquiredAt,
    nextRssAllowedAt: nextRssAllowedAt(nowMs, consecutiveFailures),
    rssChannelsConsidered: channelIds.length,
    rssFeedsSucceeded: succeeded,
    rssFeedsFailed: failed,
    rssCandidatesFetched: uniqueFetched.length,
    rssCandidatesAdded: addedCount,
    rssCandidatesDeduplicated: Math.max(0, fetched.length - uniqueFetched.length)
      + uniqueFetched.filter((item) => existingIds.has(item.external_id)).length,
    rssConsecutiveFailures: consecutiveFailures,
    lastError: results.length > 0 && succeeded === 0 ? 'RSS refresh failed for all attempted channels.' : null,
  };
  await setStorage(STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS, diagnostics);
  console.info('[MyAlgo] retrieval refresh', {
    mechanism: 'rss',
    channels: diagnostics.rssChannelsConsidered,
    succeeded: diagnostics.rssFeedsSucceeded,
    failed: diagnostics.rssFeedsFailed,
    fetched: diagnostics.rssCandidatesFetched,
    added: diagnostics.rssCandidatesAdded,
    deduplicated: diagnostics.rssCandidatesDeduplicated,
  });
  return { diagnostics, changed: addedCount > 0 };
}


async function refreshWebSearchCandidates(
  force = false,
  modeOverride?: string,
): Promise<{ diagnostics: RetrievalDiagnostics; changed: boolean }> {
  const settings = await getStorage<RetrievalSettings>(
    STORAGE_KEYS.RETRIEVAL_SETTINGS,
    DEFAULT_RETRIEVAL_SETTINGS,
  );
  const previous = await getStorage<RetrievalDiagnostics>(
    STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS,
    EMPTY_RETRIEVAL_DIAGNOSTICS,
  );
  const nowMs = Date.now();

  if (!settings.webSearchEnabled) return { diagnostics: previous, changed: false };
  if (!force && !isRetrievalAllowed(previous.nextWebSearchAllowedAt, nowMs)) {
    return { diagnostics: previous, changed: false };
  }

  const endpoint = normalizeWebSearchEndpoint(settings.webSearchEndpoint);
  if (!endpoint) {
    const diagnostics = {
      ...previous,
      lastWebSearchAt: new Date(nowMs).toISOString(),
      nextWebSearchAllowedAt: null,
      lastError: 'Web search is enabled but no valid HTTPS SearXNG endpoint is configured.',
    };
    await setStorage(STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS, diagnostics);
    return { diagnostics, changed: false };
  }

  const originPattern = webSearchOriginPattern(endpoint);
  const hasPermission = originPattern
    ? await chrome.permissions.contains({ origins: [originPattern] })
    : false;
  if (!hasPermission) {
    const diagnostics = {
      ...previous,
      lastWebSearchAt: new Date(nowMs).toISOString(),
      nextWebSearchAllowedAt: null,
      lastError: 'Grant MyAlgo access to the configured search endpoint before enabling web search.',
    };
    await setStorage(STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS, diagnostics);
    return { diagnostics, changed: false };
  }

  const state = await personalAlgorithmStore.exportState();
  const storedMode = modeOverride ?? await getStorage<string>(STORAGE_KEYS.MODE, 'Work');
  const baseProfile = buildGraphRetrievalProfile(state);
  const profile = applyModeToRetrievalProfile(baseProfile, storedMode);
  const retrievalRevision = buildGraphRetrievalRevision(state);
  const plans = buildRecommendationQueryPlans(
    profile,
    8,
    `${retrievalRevision}:mode-${storedMode.toLowerCase()}`,
    [],
    [],
    true,
  ).slice(0, 4);

  if (plans.length === 0) {
    const diagnostics = {
      ...previous,
      lastWebSearchAt: new Date(nowMs).toISOString(),
      nextWebSearchAllowedAt: nextWebSearchAllowedAt(nowMs, 0),
      webSearchPlansAttempted: 0,
      webSearchPlansSucceeded: 0,
      webSearchCandidatesFetched: 0,
      webSearchCandidatesAdded: 0,
      webSearchCandidatesDeduplicated: 0,
      webSearchConsecutiveFailures: 0,
      lastError: null,
    };
    await setStorage(STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS, diagnostics);
    return { diagnostics, changed: false };
  }

  const existingPool = await getStorage<CandidatePoolItem[]>(STORAGE_KEYS.FEED_CANDIDATE_POOL, []);
  const existingIds = new Set(existingPool.map((item) => item.external_id));
  const acquiredAt = new Date(nowMs).toISOString();
  const provider = createSearxngWebSearchProvider(endpoint);

  let candidates: PageCandidate[] = [];
  let succeeded = 0;
  let failureMessage: string | null = null;
  try {
    candidates = await acquireWebSearchCandidates(provider, plans, acquiredAt, plans.length, 8);
    succeeded = plans.length;
  } catch (error) {
    failureMessage = error instanceof Error ? error.message : 'Web search failed.';
  }

  const unique = [...new Map(candidates.map((item) => [item.external_id, item])).values()];
  const addedCount = unique.filter((item) => !existingIds.has(item.external_id)).length;
  if (unique.length > 0) {
    await mergeCandidatePool(unique);
    // Search snippets are discovery-only metadata. Canonical YouTube watch-page
    // enrichment supplies the richer metadata used by classification/scoring.
    await enrichVideos(unique.slice(0, 18));
  }

  const failed = Math.max(0, plans.length - succeeded);
  const consecutiveFailures = plans.length > 0 && succeeded === 0
    ? (previous.webSearchConsecutiveFailures ?? 0) + 1
    : 0;
  const diagnostics: RetrievalDiagnostics = {
    ...previous,
    lastWebSearchAt: acquiredAt,
    nextWebSearchAllowedAt: nextWebSearchAllowedAt(nowMs, consecutiveFailures),
    webSearchPlansAttempted: plans.length,
    webSearchPlansSucceeded: succeeded,
    webSearchCandidatesFetched: unique.length,
    webSearchCandidatesAdded: addedCount,
    webSearchCandidatesDeduplicated: Math.max(0, candidates.length - unique.length)
      + unique.filter((item) => existingIds.has(item.external_id)).length,
    webSearchConsecutiveFailures: consecutiveFailures,
    lastError: failureMessage,
  };
  await setStorage(STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS, diagnostics);

  console.info('[MyAlgo] web-search refresh', {
    mode: storedMode,
    plans: plans.length,
    fetched: unique.length,
    added: addedCount,
    failed,
  });

  return { diagnostics, changed: addedCount > 0 };
}

const ensureHistoryReconciled = (): Promise<void> => {
  if (historyReconciliationReady) return historyReconciliationReady;
  historyReconciliationReady = reconcileStoredHistoryEvidence().catch((error) => {
    historyReconciliationReady = null;
    console.warn('Stored History evidence reconciliation skipped', error);
  });
  return historyReconciliationReady;
};

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await ensureHistoryReconciled();
    await personalAlgorithmStore.initialize();
    const current = await chrome.storage.local.get([
      STORAGE_KEYS.MODE,
      STORAGE_KEYS.ENABLED,
      STORAGE_KEYS.FEED_CACHE,
      STORAGE_KEYS.FEED_CANDIDATE_POOL,
      STORAGE_KEYS.VIDEO_STORE,
      STORAGE_KEYS.LAST_SYNC,
      STORAGE_KEYS.SOURCE_FILTERS,
      STORAGE_KEYS.RETRIEVAL_SETTINGS,
      STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS,
      STORAGE_KEYS.PRIVACY_DISCLOSURE_ACCEPTED_VERSION,
      STORAGE_KEYS.HISTORY_METRICS,
      STORAGE_KEYS.HOME_OBSERVATION_ENABLED,
      STORAGE_KEYS.HOME_OBSERVATIONS,
      STORAGE_KEYS.HOME_METRICS,
      STORAGE_KEYS.SELECTION_EVENTS,
    ]);
    privacyDisclosureAccepted = isPrivacyDisclosureAccepted(
      current[STORAGE_KEYS.PRIVACY_DISCLOSURE_ACCEPTED_VERSION],
    );
    privacyDisclosureReady = Promise.resolve(privacyDisclosureAccepted);

    const firstInstall = details.reason === 'install';
    await chrome.storage.local.set({
      [STORAGE_KEYS.MODE]: current[STORAGE_KEYS.MODE] ?? 'Work',
      [STORAGE_KEYS.ENABLED]: privacyDisclosureAccepted && current[STORAGE_KEYS.ENABLED] !== false,
      [STORAGE_KEYS.FEED_CACHE]: firstInstall ? [] : current[STORAGE_KEYS.FEED_CACHE] ?? [],
      [STORAGE_KEYS.FEED_CANDIDATE_POOL]: firstInstall ? [] : current[STORAGE_KEYS.FEED_CANDIDATE_POOL] ?? [],
      [STORAGE_KEYS.VIDEO_STORE]: firstInstall ? {} : current[STORAGE_KEYS.VIDEO_STORE] ?? {},
      [STORAGE_KEYS.LAST_SYNC]: firstInstall ? null : current[STORAGE_KEYS.LAST_SYNC] ?? null,
      [STORAGE_KEYS.SOURCE_FILTERS]: current[STORAGE_KEYS.SOURCE_FILTERS] ?? {
        subscribedOnly: false,
        includeDiscovery: true,
        includeShorts: true,
        includeLive: true,
        includePlayables: true,
      },
      [STORAGE_KEYS.RETRIEVAL_SETTINGS]: current[STORAGE_KEYS.RETRIEVAL_SETTINGS] ?? DEFAULT_RETRIEVAL_SETTINGS,
      [STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS]: current[STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS] ?? EMPTY_RETRIEVAL_DIAGNOSTICS,
      // User-owned/local observational state must survive extension updates.
      [STORAGE_KEYS.HISTORY_METRICS]: current[STORAGE_KEYS.HISTORY_METRICS] ?? null,
      [STORAGE_KEYS.HOME_OBSERVATION_ENABLED]: current[STORAGE_KEYS.HOME_OBSERVATION_ENABLED] ?? false,
      [STORAGE_KEYS.HOME_OBSERVATIONS]: current[STORAGE_KEYS.HOME_OBSERVATIONS] ?? [],
      [STORAGE_KEYS.HOME_METRICS]: current[STORAGE_KEYS.HOME_METRICS] ?? null,
      [STORAGE_KEYS.SELECTION_EVENTS]: current[STORAGE_KEYS.SELECTION_EVENTS] ?? [],
    });
    if (!privacyDisclosureAccepted) {
      await chrome.runtime.openOptionsPage();
    }
  })().catch((error) => console.warn('Privacy-aware install initialization failed', error));
});

async function rankLocalCandidates(
  candidates: CandidatePoolItem[],
  sourceFilters: FeedSourceFilters,
  mode: string,
): Promise<LocalFeedItem[]> {
  const state = await personalAlgorithmStore.exportState();
  const feedbackEvents = await getStorage<Array<{ kind: string; payload: unknown; recordedAt: string }>>(
    'personal-algorithm-local-events',
    [],
  );
  const feedbackSignals = buildLocalFeedbackSignals(
    feedbackEvents
      .filter((event) => event.kind === 'feedback')
      .map((event) => ({
        ...(event.payload as { contentItemId?: string; eventType?: string; channelId?: string | null }),
        recordedAt: event.recordedAt,
      })),
    state,
  );
  const ranked = scoreLocalCandidates(
    state,
    candidates,
    mode,
    feedbackSignals,
    sourceFilters,
  );

  const traces = ranked.slice(0, 60).map((item) => ({
    traceId: item.trace.id,
    candidateId: item.id,
    score: item.score,
    recordedAt: new Date().toISOString(),
  }));
  const traceSignature = traces.map((item) => `${item.traceId}:${item.score}`).join('|');
  if (traceSignature !== lastPersistedTraceSignature) {
    lastPersistedTraceSignature = traceSignature;
    await setStorage(STORAGE_KEYS.PERSONAL_ALGORITHM_LOCAL_TRACES, traces);
  }

  return ranked.map(({ trace, ...item }) => {
    const contributions = [
      ...trace.featureContributions,
      ...trace.nodeContributions,
      ...trace.edgeContributions,
      ...trace.feedbackContributions,
      ...trace.modeContributions,
    ]
      .filter((contribution) => contribution.value !== 0)
      .sort((left, right) => Math.abs(right.value) - Math.abs(left.value) || left.label.localeCompare(right.label))
      .slice(0, 5)
      .map((contribution) => ({
        label: contribution.label,
        value: contribution.value,
        kind: contribution.kind,
      }));

    return {
      ...item,
      suppressed: trace.suppressed,
      policyOutcome: trace.policyOutcome,
      source_kind: item.source_kind ?? null,
      traceId: trace.id,
      explanation: {
        rawScore: trace.finalScore,
        displayScore: item.score,
        graphRevision: trace.graphRevision,
        acquisitionMechanism: item.provenance?.mechanism ?? null,
        contributions,
      },
    };
  });
}

async function recordLocalEvent(kind: 'activity' | 'feedback' | 'selection', payload: unknown): Promise<void> {
  const events = await getStorage<Array<{ kind: string; payload: unknown; recordedAt: string }>>('personal-algorithm-local-events', []);
  await setStorage('personal-algorithm-local-events', [
    ...events.slice(-199),
    { kind, payload, recordedAt: new Date().toISOString() },
  ]);
}

async function notifyPersonalAlgorithmChanged(reason: 'feedback' | 'rebuild' | 'retrieval'): Promise<void> {
  const tabs = await chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] });
  await Promise.all(tabs.map((tab) => tab.id
    ? chrome.tabs.sendMessage(tab.id, {
      type: 'PERSONAL_ALGORITHM_CHANGED',
      payload: { reason },
    }).catch(() => undefined)
    : undefined));
}

const handleRuntimeMessage = (
  message: unknown,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void,
  privacyChecked = false,
): boolean => {
  const { type, payload } = message as {
    type: string;
    payload?: {
      mode?: string;
      algorithmId?: string;
      enabled?: boolean;
      contentItemId?: string;
      externalId?: string;
      eventType?: string;
      sourceFilters?: FeedSourceFilters;
      retrievalSettings?: RetrievalSettings;
      evidence?: unknown[];
      observations?: unknown[];
      metrics?: unknown;
    };
  };

  if (type === 'PERSONAL_ALGORITHM_HEALTH') {
    void Promise.all([
      getStorage(STORAGE_KEYS.ENABLED, false),
      getStorage(STORAGE_KEYS.MODE, 'Work'),
    ]).then(([enabled, mode]) => sendResponse({
      ok: true,
      worker: 'ready',
      enabled,
      mode,
    })).catch((error) => sendResponse({
      ok: false,
      worker: 'error',
      error: error instanceof Error ? error.message : 'Unable to read worker state.',
    }));
    return true;
  }

  if (type === 'ACCEPT_PRIVACY_DISCLOSURE') {
    void (async () => {
      await chrome.storage.local.set({
        [STORAGE_KEYS.PRIVACY_DISCLOSURE_ACCEPTED_VERSION]: PRIVACY_DISCLOSURE_VERSION,
        [STORAGE_KEYS.ENABLED]: true,
      });
      privacyDisclosureAccepted = true;
      privacyDisclosureReady = Promise.resolve(true);
      const tabs = await chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: 'EXTENSION_ENABLED', payload: { enabled: true } }).catch(() => undefined)
        : undefined));
      sendResponse({ ok: true, version: PRIVACY_DISCLOSURE_VERSION });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to save privacy disclosure acceptance.' }));
    return true;
  }

  if (type === 'RESET_LOCAL_DATA') {
    void (async () => {
      privacyDisclosureAccepted = false;
      privacyDisclosureReady = Promise.resolve(false);
      historyReconciliationReady = null;
      await chrome.storage.local.clear();
      // The store caches state in the service worker. Reset it after clearing
      // storage so deleted graph/evidence cannot survive in memory or be
      // persisted again by a later mutation in the same worker lifetime.
      await personalAlgorithmStore.reset();
      await chrome.storage.local.set({
        [STORAGE_KEYS.MODE]: 'Work',
        [STORAGE_KEYS.ENABLED]: false,
        [STORAGE_KEYS.HISTORY_EVIDENCE]: [],
        [STORAGE_KEYS.HOME_OBSERVATION_ENABLED]: false,
        [STORAGE_KEYS.HOME_OBSERVATIONS]: [],
        [STORAGE_KEYS.SELECTION_EVENTS]: [],
        [STORAGE_KEYS.RETRIEVAL_SETTINGS]: DEFAULT_RETRIEVAL_SETTINGS,
        [STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS]: EMPTY_RETRIEVAL_DIAGNOSTICS,
      });
      const tabs = await chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: 'EXTENSION_ENABLED', payload: { enabled: false } }).catch(() => undefined)
        : undefined));
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to delete local MyAlgo data.' }));
    return true;
  }

  if (PRIVACY_GATED_MESSAGE_TYPES.has(type) && !privacyChecked) {
    void ensurePrivacyDisclosureLoaded().then((accepted) => {
      if (!accepted) {
        sendResponse({ ok: false, error: 'Accept the current privacy disclosure before MyAlgo observes or stores YouTube activity.' });
        return;
      }
      handleRuntimeMessage(message, _sender, sendResponse, true);
    }).catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to load privacy disclosure state.',
    }));
    return true;
  }

  if (type === 'PERSONAL_ALGORITHM_REVIEW') {
    void ensureHistoryReconciled().then(() => personalAlgorithmStore.reviewGraph())
      .then((review) => sendResponse({ ok: true, review }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to review Personal Algorithm Graph.' }));
    return true;
  }

  if (type === 'PERSONAL_ALGORITHM_REBUILD') {
    void ensureHistoryReconciled().then(() => personalAlgorithmStore.rebuildGraphFromEvidence())
      .then(async (graph) => {
        await notifyPersonalAlgorithmChanged('rebuild');
        sendResponse({ ok: true, graph });
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to rebuild Personal Algorithm Graph.' }));
    return true;
  }

  if (type === 'PERSONAL_ALGORITHM_EXPORT') {
    void ensureHistoryReconciled().then(() => personalAlgorithmStore.exportStateJson())
      .then((json) => sendResponse({ ok: true, json }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to export Personal Algorithm Graph.' }));
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.GET_BEHAVIOR) {
    void (async () => {
      const surfaced = await getStorage<RecommendationObservation[]>(STORAGE_KEYS.HOME_OBSERVATIONS, []);
      const interactions = await getStorage<UserBehaviorObservation[]>(STORAGE_KEYS.SELECTION_EVENTS, []);
      const videoId = (payload as { videoId?: string } | undefined)?.videoId;
      const behavior = videoId
        ? getBehaviorForVideo(videoId, surfaced, interactions)
        : correlateBehavior(surfaced, interactions);
      sendResponse({ ok: true, behavior });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to correlate behavior.',
    }));
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.GET_FEED) {
    void getStorage(STORAGE_KEYS.FEED_CACHE, []).then((feed) => {
      sendResponse({ feed });
    });
    return true;
  }

  if (type === 'RANK_PAGE') {
    void (async () => {
      const rankStartedAt = performance.now();
      try {
        const sourceFilters = await getStorage<FeedSourceFilters>(STORAGE_KEYS.SOURCE_FILTERS, {});
        const incomingCandidates = (payload as { candidates?: PageCandidate[] }).candidates ?? [];

        // First paint must never wait on network enrichment. Merge the live DOM
        // candidates immediately and hydrate only from metadata already cached
        // in local storage. Rich watch-page enrichment runs after the rank
        // response and requests a follow-up rerank only when it produced data.
        const candidatePool = await mergeCandidatePool(incomingCandidates);
        const currentPageIds = new Set(incomingCandidates.map((candidate) => candidate.external_id).filter(Boolean));

        // Do not rescore the entire persistent reservoir on every YouTube DOM
        // mutation. Score every current-page item plus a bounded off-page
        // replacement working set. The full pool remains persisted for later
        // retrieval/rotation but is not materialized into every ranking pass.
        const currentPagePool = candidatePool.filter((item) => currentPageIds.has(item.external_id));
        const offPagePool = candidatePool
          .filter((item) => !currentPageIds.has(item.external_id))
          .sort((left, right) => (
            new Date(right.lastAcquiredAt ?? right.lastSeenAt).getTime()
            - new Date(left.lastAcquiredAt ?? left.lastSeenAt).getTime()
          ))
          .slice(0, MAX_REPLACEMENT_WORKING_SET);
        const workingPool = [...currentPagePool, ...offPagePool].slice(0, MAX_RANK_WORKING_SET);
        const hydratedWorkingPool = await hydrateCandidatePool(workingPool);
        const ranked = await rankLocalCandidates(hydratedWorkingPool, sourceFilters, payload?.mode ?? 'default');
        const feedCache = ranked.slice(0, MAX_FEED_CACHE_SIZE);

        // The popup cache is intentionally bounded to the top-ranked reservoir,
        // but presentation must always receive scores for every candidate on the
        // current page. Otherwise a large/RSS-expanded reservoir can push all
        // visible native cards outside the top 100, making them look "unmatched"
        // and removing badges/replacement eligibility from the live page.
        const currentPageFeed = ranked.filter((item) => currentPageIds.has(item.external_id));

        // Replacement inventory must be independent of the global top-N cache.
        // A large Home page can itself occupy the entire top 100, leaving the
        // content script with no off-page RSS/search candidates after native IDs
        // are blocked. Keep a separately bounded off-page reservoir in the live
        // presentation response.
        const replacementInventory = ranked
          .filter((item) => !currentPageIds.has(item.external_id))
          .slice(0, MAX_FEED_CACHE_SIZE);
        const presentationFeed = [
          ...currentPageFeed,
          ...replacementInventory,
        ];

        await setStorage(STORAGE_KEYS.FEED_CACHE, feedCache);
        await setStorage(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
        await setStorage('personal-algorithm-last-error', null);
        sendResponse({
          ok: true,
          feed: presentationFeed,
          cachedFeedSize: feedCache.length,
          currentPageScored: currentPageFeed.length,
          replacementInventorySize: replacementInventory.length,
          poolSize: candidatePool.length,
          rankingWorkingSetSize: workingPool.length,
          enriched: 0,
          enrichmentPending: true,
          elapsedMs: Math.round(performance.now() - rankStartedAt),
        });

        const senderTabId = _sender.tab?.id;
        void enrichVideos(incomingCandidates).then(async (enrichedCandidates) => {
          if (enrichedCandidates.length === 0) return;
          await mergeCandidatePool(enrichedCandidates);
          if (senderTabId) {
            await chrome.tabs.sendMessage(senderTabId, {
              type: 'YOUTUBE_METADATA_ENRICHED',
              payload: {
                count: enrichedCandidates.length,
              },
            }).catch(() => undefined);
          }
        }).catch((error) => {
          console.warn('[MyAlgo] asynchronous metadata enrichment failed', error);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to rank page.';
        await setStorage('personal-algorithm-last-error', message);
        console.error('Failed to rank current YouTube page', message);
        sendResponse({ ok: false, error: message });
      }
    })();
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.SET_MODE) {
    const nextMode = payload?.mode ?? 'Work';
    void (async () => {
      await setStorage(STORAGE_KEYS.MODE, nextMode);
      const settings = await getStorage<RetrievalSettings>(
        STORAGE_KEYS.RETRIEVAL_SETTINGS,
        DEFAULT_RETRIEVAL_SETTINGS,
      );
      if (settings.webSearchEnabled) {
        void refreshWebSearchCandidates(true, nextMode).then(async (refresh) => {
          if (refresh.changed) await notifyPersonalAlgorithmChanged('retrieval');
        }).catch((error) => console.warn('[MyAlgo] mode-driven web search refresh failed', error));
      }
      const tabs = await chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: 'MODE_CHANGED', payload: { mode: nextMode } }).catch(() => undefined)
        : undefined));
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to change mode.' }));
    return true;
  }

  if (type === 'SET_ENABLED') {
    const enabled = payload?.enabled !== false;
    if (enabled && !privacyDisclosureAccepted) {
      sendResponse({ ok: false, enabled: false, error: 'Accept the current privacy disclosure before enabling MyAlgo.' });
      return false;
    }
    void (async () => {
      await setStorage(STORAGE_KEYS.ENABLED, enabled);
      const tabs = await chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: 'EXTENSION_ENABLED', payload: { enabled } }).catch(() => undefined)
        : undefined));
    })();
    sendResponse({ ok: true, enabled });
    return true;
  }

  if (type === 'SET_RETRIEVAL_SETTINGS') {
    void (async () => {
      const previousSettings = await getStorage<RetrievalSettings>(
        STORAGE_KEYS.RETRIEVAL_SETTINGS,
        DEFAULT_RETRIEVAL_SETTINGS,
      );
      const next: RetrievalSettings = {
        ...DEFAULT_RETRIEVAL_SETTINGS,
        ...(payload?.retrievalSettings ?? {}),
      };
      await setStorage(STORAGE_KEYS.RETRIEVAL_SETTINGS, next);
      let diagnostics = await getStorage<RetrievalDiagnostics>(
        STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS,
        EMPTY_RETRIEVAL_DIAGNOSTICS,
      );
      let changed = false;

      if (next.rssEnabled) {
        const rssRefresh = await refreshRssCandidates(!previousSettings.rssEnabled);
        diagnostics = rssRefresh.diagnostics;
        changed = changed || rssRefresh.changed;
      }
      if (next.webSearchEnabled) {
        const searchRefresh = await refreshWebSearchCandidates(
          !previousSettings.webSearchEnabled
            || previousSettings.webSearchEndpoint !== next.webSearchEndpoint,
        );
        diagnostics = searchRefresh.diagnostics;
        changed = changed || searchRefresh.changed;
      }
      if (changed) {
        await notifyPersonalAlgorithmChanged('retrieval');
      }
      sendResponse({ ok: true, retrievalSettings: next, diagnostics });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to update retrieval settings.',
    }));
    return true;
  }

  if (type === 'REFRESH_RETRIEVAL') {
    void (async () => {
      const settings = await getStorage<RetrievalSettings>(
        STORAGE_KEYS.RETRIEVAL_SETTINGS,
        DEFAULT_RETRIEVAL_SETTINGS,
      );
      let diagnostics = await getStorage<RetrievalDiagnostics>(
        STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS,
        EMPTY_RETRIEVAL_DIAGNOSTICS,
      );
      let changed = false;
      if (settings.rssEnabled) {
        const rssRefresh = await refreshRssCandidates(true);
        diagnostics = rssRefresh.diagnostics;
        changed = changed || rssRefresh.changed;
      }
      if (settings.webSearchEnabled) {
        const searchRefresh = await refreshWebSearchCandidates(true);
        diagnostics = searchRefresh.diagnostics;
        changed = changed || searchRefresh.changed;
      }
      if (changed) {
        await notifyPersonalAlgorithmChanged('retrieval');
      }
      sendResponse({ ok: true, diagnostics });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to refresh retrieval.',
    }));
    return true;
  }

  if (type === 'GET_RETRIEVAL_PLAN') {
    void Promise.all([
      personalAlgorithmStore.exportState(),
      getStorage<string>(STORAGE_KEYS.MODE, 'Work'),
    ]).then(([state, mode]) => {
      const baseProfile = buildGraphRetrievalProfile(state);
      const profile = applyModeToRetrievalProfile(baseProfile, mode);
      const retrievalRevision = buildGraphRetrievalRevision(state);
      const plans = buildRecommendationQueryPlans(
        profile,
        8,
        `${retrievalRevision}:mode-${mode.toLowerCase()}`,
        [],
        [],
        true,
      );
      sendResponse({
        ok: true,
        mode,
        graphRevision: state.graph.currentRevision,
        retrievalRevision,
        goal: profile.goal,
        topicCount: profile.explicitTopics.length,
        creatorCount: profile.creatorTerms.length,
        plans,
      });
    }).catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to build retrieval plan.',
    }));
    return true;
  }

  if (type === 'GET_RETRIEVAL_DIAGNOSTICS') {
    void Promise.all([
      getStorage<RetrievalSettings>(STORAGE_KEYS.RETRIEVAL_SETTINGS, DEFAULT_RETRIEVAL_SETTINGS),
      getStorage<RetrievalDiagnostics>(STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS, EMPTY_RETRIEVAL_DIAGNOSTICS),
    ]).then(([retrievalSettings, diagnostics]) => {
      sendResponse({ ok: true, retrievalSettings, diagnostics });
    }).catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to read retrieval diagnostics.',
    }));
    return true;
  }

  if (type === 'SET_SOURCE_FILTERS') {
    void (async () => {
      await setStorage(STORAGE_KEYS.SOURCE_FILTERS, payload?.sourceFilters ?? {});
      const tabs = await chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, {
          type: 'SOURCE_FILTERS_CHANGED',
          payload: { sourceFilters: payload?.sourceFilters ?? {} },
        }).catch(() => undefined)
        : undefined));
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.FEEDBACK) {
    void (async () => {
      await recordLocalEvent('feedback', payload);
      await setStorage(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
      await notifyPersonalAlgorithmChanged('feedback');
      sendResponse({ ok: true, contentItemId: payload?.contentItemId, eventType: payload?.eventType });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to store feedback.',
    }));
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.ACTIVITY) {
    void recordLocalEvent('activity', payload);
    sendResponse({ ok: true, externalId: payload?.externalId, eventType: payload?.eventType });
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.SELECTION_OBSERVATION) {
    void (async () => {
      const observation = (payload as { observation?: unknown } | undefined)?.observation as SelectionObservation | undefined;
      if (!observation?.videoId || observation.provenance !== 'youtube_user_interaction') {
        sendResponse({ ok: false, error: 'Invalid selection observation.' });
        return;
      }
      const existing = await getStorage<UserBehaviorObservation[]>(STORAGE_KEYS.SELECTION_EVENTS, []);
      const events = [...existing, observation].slice(-MAX_SELECTION_EVENTS);
      await setStorage(STORAGE_KEYS.SELECTION_EVENTS, events);
      await persistNormalizedEvidence(
        toNormalizedInteraction(observation),
        `interaction:clicked:${observation.videoId}:${observation.observedAt}:${observation.exposureId ?? ''}`,
      );
      await recordLocalEvent('selection', observation);
      sendResponse({ ok: true, storedEvents: events.length });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to store selection observation.' }));
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.WATCH_OBSERVATION) {
    void (async () => {
      const observation = (payload as { observation?: unknown } | undefined)?.observation as TemporalWatchObservation | undefined;
      if (
        !observation?.videoId
        || observation.kind !== 'watched'
        || observation.source !== 'player'
        || observation.provenance !== 'youtube_player_telemetry'
        || !observation.sessionId
        || !Number.isFinite(observation.playedSeconds)
        || observation.playedSeconds <= 0
      ) {
        sendResponse({ ok: false, error: 'Invalid temporal watch observation.' });
        return;
      }
      const existing = await getStorage<UserBehaviorObservation[]>(STORAGE_KEYS.SELECTION_EVENTS, []);
      const key = `player|watched|${observation.videoId}|${observation.sessionId}`;
      const existingKeys = new Set(existing
        .filter((event): event is Extract<UserBehaviorObservation, { kind: 'watched' }> => (
          event.kind === 'watched'
          && 'sessionId' in event
          && typeof event.sessionId === 'string'
        ))
        .map((event) => `player|watched|${event.videoId}|${event.sessionId}`));
      if (existingKeys.has(key)) {
        sendResponse({ ok: true, storedEvents: existing.length, duplicate: true });
        return;
      }
      const events = [...existing, observation].slice(-MAX_SELECTION_EVENTS);
      await setStorage(STORAGE_KEYS.SELECTION_EVENTS, events);
      await persistNormalizedEvidence(
        toNormalizedInteraction(observation),
        `interaction:watched:${observation.videoId}:${observation.sessionId}`,
      );
      await recordLocalEvent('selection', observation);
      sendResponse({ ok: true, storedEvents: events.length });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to store temporal watch observation.' }));
    return true;
  }

  if (type === 'PERSONAL_ALGORITHM_BACKFILL_HISTORY_METADATA') {
    void (async () => {
      await ensureHistoryReconciled();
      const historyEvidence = await getStorage<HistoryEvidence[]>(STORAGE_KEYS.HISTORY_EVIDENCE, []);
      const normalizedInputs = historyEvidence.map((item) => ({
        id: createHistoryEvidenceId(item.externalId),
        evidence: toNormalizedInteraction({
          videoId: item.externalId,
          exposureId: null,
          title: item.title,
          creator: item.creator,
          historyTimestamp: item.historyTimestamp,
          kind: 'watched',
          source: 'history',
          observedAt: item.observedAt,
          provenance: 'youtube_history_dom',
        }),
        confidence: 1,
      }));
      await personalAlgorithmStore.reconcileHistoryEvidence(normalizedInputs);
      const graph = await personalAlgorithmStore.rebuildGraphFromEvidence();
      sendResponse({ ok: true, historyCount: historyEvidence.length, graph });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to backfill history metadata.',
    }));
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.HISTORY_OBSERVATION) {
    console.info('[MyAlgo] received history observation');
    void (async () => {
      const historyEvidence = Array.isArray(payload?.evidence) ? payload.evidence as HistoryEvidence[] : [];
      const existing = await getStorage<HistoryEvidence[]>(STORAGE_KEYS.HISTORY_EVIDENCE, []);
      const validHistoryEvidence = historyEvidence.filter((item) => (
        item?.externalId && item.title && item.provenance === 'youtube_history_dom'
      ));
      const evidence = mergeHistoryEvidence(existing, validHistoryEvidence)
        .slice(0, MAX_HISTORY_EVIDENCE);
      console.info('[MyAlgo] history observation prepared', {
        incoming: historyEvidence.length,
        validIncoming: validHistoryEvidence.length,
        existing: existing.length,
        merged: evidence.length,
      });
      await setStorage(STORAGE_KEYS.HISTORY_EVIDENCE, evidence);
      await setStorage(STORAGE_KEYS.HISTORY_METRICS, payload?.metrics as HistoryObservationMetrics);
      const existingEvents = await getStorage<UserBehaviorObservation[]>(STORAGE_KEYS.SELECTION_EVENTS, []);
      const nonHistoryEvents = existingEvents.filter((event) => !(event.kind === 'watched' && event.source === 'history'));
      const watchedEvents = evidence.map((item) => ({
        videoId: item.externalId,
        exposureId: null,
        title: item.title,
        creator: item.creator,
        historyTimestamp: item.historyTimestamp,
        kind: 'watched' as const,
        source: 'history' as const,
        observedAt: item.observedAt,
        provenance: 'youtube_history_dom' as const,
      }));
      await setStorage(STORAGE_KEYS.SELECTION_EVENTS, [
        ...nonHistoryEvents,
        ...watchedEvents,
      ].slice(-MAX_SELECTION_EVENTS));
      await ensureHistoryReconciled();
      await personalAlgorithmStore.reconcileHistoryEvidence(
        watchedEvents.map((event) => ({
          id: createHistoryEvidenceId(event.videoId),
          evidence: toNormalizedInteraction(event),
          confidence: 1,
        })),
      );
      console.info('[MyAlgo] history observation persisted', {
        storedEvidence: evidence.length,
      });
      sendResponse({ ok: true, storedEvidence: evidence.length });
    })().catch((error) => {
      console.error('[MyAlgo] history observation failed', error);
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to store history observation.' });
    });
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.RECOMMENDATION_OBSERVATION) {
    console.info('[MyAlgo] received recommendation observation');
    void (async () => {
      const incoming = Array.isArray(payload?.observations) ? payload.observations as RecommendationObservation[] : [];
      const existing = await getStorage<RecommendationObservation[]>(STORAGE_KEYS.HOME_OBSERVATIONS, []);
      const validIncoming = incoming.filter((observation) => (
        observation?.externalId && observation.title && observation.evidenceKind === 'surfaced'
      ));
      const observations = mergeRecommendationObservations(existing, validIncoming);
      console.info('[MyAlgo] recommendation observation prepared', {
        incoming: incoming.length,
        validIncoming: validIncoming.length,
        existing: existing.length,
        merged: observations.length,
      });
      await setStorage(STORAGE_KEYS.HOME_OBSERVATIONS, observations);
      await setStorage(STORAGE_KEYS.HOME_METRICS, payload?.metrics as RecommendationObservationMetrics);
      await Promise.all(validIncoming.map((observation) => persistNormalizedEvidence(
        toNormalizedExposure(observation),
        `exposure:${observation.exposureId}`,
      )));
      console.info('[MyAlgo] recommendation observation persisted', {
        storedObservations: observations.length,
      });
      sendResponse({ ok: true, storedObservations: observations.length });
    })().catch((error) => {
      console.error('[MyAlgo] recommendation observation failed', error);
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to store recommendation observation.' });
    });
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.OPEN_OPTIONS) {
    void chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  sendResponse({ ok: false });
  return true;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => (
  handleRuntimeMessage(message, sender, sendResponse)
));

chrome.runtime.onMessageExternal.addListener((_message, _sender, sendResponse) => {
  sendResponse({ ok: true });
  return true;
});

const message = createMessage(EXTENSION_MESSAGE_TYPES.GET_FEED, { algorithmId: 'demo' });
console.info('Background service worker ready', message);
