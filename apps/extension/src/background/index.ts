import { createMessage, EXTENSION_MESSAGE_TYPES } from '../lib/messaging';
import { STORAGE_KEYS, getStorage, setStorage, setStorageBatch } from '../lib/storage';
import type { CandidateAcquisitionProvenance, CandidateModeAffinity, DurableSemanticModeCatalog, FeedSourceFilters, ModeSupplyDiagnostics, RetrievalDiagnostics, RetrievalSettings, SemanticCategoryId } from '@repo/shared-types';
import { youtubeConnector } from '../connectors/youtube';
import { createHistoryEvidenceId, mergeHistoryEvidence, type HistoryEvidence, type HistoryObservationMetrics } from '../content-scripts/youtube-history';
import { mergeRecommendationObservations, type RecommendationObservation, type RecommendationObservationMetrics } from '../content-scripts/youtube-recommendations';
import type { SelectionObservation, UserBehaviorObservation } from '../content-scripts/youtube-interactions';
import type { TemporalWatchObservation } from '../content-scripts/youtube-watch';
import { correlateBehavior, getBehaviorForVideo } from '../content-scripts/behavior-correlation';
import { toNormalizedInteraction } from '../content-scripts/youtube-interactions';
import { toNormalizedExposure } from '../content-scripts/youtube-recommendations';
import { createChromeLocalStateStorage, LocalPersonalAlgorithmStore } from '../lib/personal-algorithm-store';
import { buildLocalFeedbackSignals, getLocalScoringDiagnostics, scoreLocalCandidates, summarizeLocalScoreCalibration } from './personal-algorithm-runtime';
import { applyDurableModeToRetrievalProfile, applyModeToRetrievalProfile, buildCandidateEmbeddingText, buildCandidateModeAffinities, buildCanonicalSemanticConcepts, buildDurableSemanticModeClusters, buildGraphRetrievalProfile, buildGraphRetrievalRevision, buildRecommendationQueryPlans, buildSemanticConceptMaterialization, buildConceptVerificationInput, conceptExtractionInputHash, CONCEPT_EXTRACTION_MODEL_ID, CONCEPT_EXTRACTION_MODEL_VERSION, CONCEPT_EXTRACTION_PIPELINE_VERSION, DURABLE_MODE_AFFINITY_PIPELINE_ID, DURABLE_SEMANTIC_MODE_PIPELINE_ID, enrichCandidatesWithSemanticReranking, reconcileDurableSemanticModes, resolveDurableMode, semanticInputHash, SEMANTIC_CONCEPT_MATERIALIZER_ID } from '@repo/recommender-core';
import { PRIVACY_DISCLOSURE_VERSION, isPrivacyDisclosureAccepted } from '../lib/privacy';
import { acquireWebSearchCandidates, isRetrievalAllowed, mergeCandidateAcquisitionHistory, nextRssAllowedAt, nextWebSearchAllowedAt, reconcileModeSupplyForSelection, selectWebSearchPlans, shouldRefreshObservedCandidate } from './retrieval';
import { buildYoutubeRssFeedUrl, needsYoutubeMetadataRefresh, parseYoutubeRssFeed, selectYoutubeRssChannelIds } from '../connectors/youtube-acquisition';
import { createChromeEmbeddingCache } from '../lib/semantic-embedding-cache';
import { createOffscreenEmbeddingProvider, semanticProviderIdentity, type SemanticModelMode } from '../lib/semantic-embedding-provider';
import { createLocalConceptExtractionProvider } from '../lib/concept-extraction-provider';

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
  semantic_mode_affinities?: CandidateModeAffinity[];
};

type SemanticFeatureRecord = {
  externalId: string;
  inputHash: string;
  graphRevision: number;
  mode: string;
  modelVersion: string;
  requestedModelVersion: string;
  fallbackReason: string | null;
  graphSimilarity: number;
  modeSimilarity: number;
  category: SemanticCategoryId | null;
  categoryConfidence: number;
  categoryScores: Partial<Record<SemanticCategoryId, number>>;
  graphMatches: Array<{
    node_id: string;
    node_label: string;
    similarity: number;
    weight: number;
    canonical_id?: string;
    source_node_ids?: string[];
    taxonomy_only?: boolean;
    pipeline_id?: string;
  }>;
  modeAffinities: CandidateModeAffinity[];
  modeAffinityPipelineId: string;
  modeCatalogSignature: string;
  generatedAt: string;
};

type ConceptExtractionCacheRecord = {
  externalId: string;
  inputHash: string;
  modelVersion: string;
  concepts: string[];
  backend: string;
  generatedAt: string;
};

type ConceptExtractionRefreshResult = {
  conceptsByExternalId: Map<string, string[]>;
  diagnostics: Record<string, unknown>;
};

type LocalFeedItem = CandidatePoolItem & {
  content_label?: 'learning' | 'work' | 'relax' | null;
  content_label_confidence?: number | null;
  semantic_category?: SemanticCategoryId | null;
  semantic_category_confidence?: number | null;
  semantic_category_scores?: Partial<Record<SemanticCategoryId, number>>;
  semantic_mode_similarity?: number | null;
  semantic_model_version?: string | null;
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
    policyRevision: string;
    acquisitionMechanism: string | null;
    contributions: Array<{
      label: string;
      value: number;
      kind: string;
      sourceId?: string;
      sourceIds?: string[];
      evidenceIds: string[];
      modeId?: string;
      modeRevision?: number;
      canonicalId?: string;
    }>;
    matchedPaths: Array<{
      nodeIds: string[];
      nodeLabels: string[];
      edgeIds: string[];
      evidenceIds: string[];
    }>;
    modeGrounding: {
      modeId: string;
      modeRevision: number;
      total: number;
      members: Array<{
        canonicalId: string;
        label: string;
        value: number;
        sourceIds: string[];
        evidenceIds: string[];
      }>;
    } | null;
  };
};

const candidateHasAcquisitionMechanism = (
  candidate: { provenance?: CandidateAcquisitionProvenance; acquisition_history?: CandidateAcquisitionProvenance[] },
  mechanism: CandidateAcquisitionProvenance['mechanism'],
): boolean => (
  candidate.provenance?.mechanism === mechanism
  || candidate.acquisition_history?.some((entry) => entry.mechanism === mechanism) === true
);

const MAX_CANDIDATE_POOL_SIZE = 800;
const MAX_HISTORY_EVIDENCE = 2000;
const MAX_FEED_CACHE_SIZE = 80;
const MAX_VIDEO_STORE_SIZE = 500;
const MAX_METADATA_ENRICHMENTS_PER_SCAN = 6;
const MAX_SELECTION_EVENTS = 750;
const MAX_HOME_OBSERVATIONS = 300;
const MAX_DEFAULT_ALGORITHM_EVIDENCE = 3000;
const MAX_HISTORY_ITEMS_PER_OBSERVATION = 500;
const MAX_SEMANTIC_FEATURE_CACHE = 600;
const MAX_CONCEPT_EXTRACTION_CACHE = 600;
const MAX_CONCEPT_EXTRACTIONS_PER_REFRESH = 2;
const MAX_NEURAL_CANDIDATES_PER_REFRESH = 8;
const CONCEPT_EXTRACTION_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const NEURAL_FALLBACK_RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const METADATA_REFRESH_MS = 24 * 60 * 60 * 1000;
const OBSERVED_CANDIDATE_REFRESH_MS = 30_000;
const MAX_RANK_WORKING_SET = 320;
const MAX_REPLACEMENT_WORKING_SET = 180;
const LEGACY_FIXED_MODES = new Set(['work', 'learning', 'relax', 'gaming', 'french']);

const migrateStoredMode = (value: unknown): string => {
  const mode = typeof value === 'string' ? value.trim() : '';
  if (!mode || LEGACY_FIXED_MODES.has(mode.toLowerCase())) return 'Default';
  return mode;
};

const DEFAULT_RETRIEVAL_SETTINGS: RetrievalSettings = {
  rssEnabled: false,
  webSearchEnabled: false,
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
  modeSupply: null,
  lastError: null,
};
const personalAlgorithmStore = new LocalPersonalAlgorithmStore(createChromeLocalStateStorage());
const semanticEmbeddingCache = createChromeEmbeddingCache(600);

const reconcileRetrievalDiagnosticsForActiveMode = async (
  diagnostics: RetrievalDiagnostics,
): Promise<RetrievalDiagnostics> => {
  const [activeModeId, durableModeCatalog] = await Promise.all([
    getStorage<string>(STORAGE_KEYS.ACTIVE_MODE_ID, 'default'),
    getStorage<DurableSemanticModeCatalog | null>(
      STORAGE_KEYS.DURABLE_MODE_CATALOG,
      null,
    ),
  ]);
  const activeDurableMode = resolveDurableMode(durableModeCatalog, activeModeId);
  return reconcileModeSupplyForSelection(
    diagnostics,
    activeDurableMode?.id ?? 'default',
    activeDurableMode?.revision ?? null,
  );
};

const persistRetrievalDiagnostics = async (
  diagnostics: RetrievalDiagnostics,
): Promise<RetrievalDiagnostics> => {
  const reconciled = await reconcileRetrievalDiagnosticsForActiveMode(diagnostics);
  await setStorage(STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS, reconciled);
  return reconciled;
};

const getSemanticModelMode = async (): Promise<SemanticModelMode> => {
  const stored = await getStorage<string>(STORAGE_KEYS.SEMANTIC_MODEL_MODE, 'hash');
  return stored === 'neural' ? 'neural' : 'hash';
};

const getSemanticProviderContext = async () => {
  const semanticModelMode = await getSemanticModelMode();
  const storedBatchSize = await getStorage<number>(STORAGE_KEYS.SEMANTIC_NEURAL_BATCH_SIZE, 1);
  const neuralBatchSize = Math.max(1, Math.min(16, Math.floor(Number(storedBatchSize) || 1)));
  const provider = createOffscreenEmbeddingProvider(semanticModelMode, { neuralBatchSize });
  const identity = semanticProviderIdentity(semanticModelMode);
  return {
    semanticModelMode,
    neuralBatchSize,
    provider,
    semanticModelIdentity: `${identity.modelId}@${identity.modelVersion}`,
  };
};

const durableModeCatalogSignature = (
  catalog: DurableSemanticModeCatalog | null | undefined,
): string => {
  const input = JSON.stringify(
    [...(catalog?.modes ?? [])]
      .filter((mode) => mode.active)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((mode) => ({
        id: mode.id,
        revision: mode.revision,
        members: [...mode.members]
          .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
          .map((member) => ({
            canonicalId: member.canonicalId,
            weight: member.weight,
            sourceNodeIds: [...member.sourceNodeIds].sort(),
          })),
      })),
  );
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${DURABLE_MODE_AFFINITY_PIPELINE_ID}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const refreshDurableModeCatalog = async (
  state: Awaited<ReturnType<typeof personalAlgorithmStore.exportState>>,
): Promise<DurableSemanticModeCatalog> => {
  const previous = await getStorage<DurableSemanticModeCatalog | null>(
    STORAGE_KEYS.DURABLE_MODE_CATALOG,
    null,
  );
  const canonical = buildCanonicalSemanticConcepts(state);
  const clustered = buildDurableSemanticModeClusters(state, canonical, {
    minimumSupportPerConcept: 2,
    minimumSharedContent: 2,
    minimumSupportJaccard: 0.5,
    minimumMembers: 2,
  });
  const reconciled = reconcileDurableSemanticModes(
    previous,
    clustered.proposals,
    state.graph.currentRevision,
    new Date().toISOString(),
    {
      minimumIdentityJaccard: 0.5,
      maxModes: 12,
    },
  );

  if (reconciled.changed || !previous) {
    await setStorage(STORAGE_KEYS.DURABLE_MODE_CATALOG, reconciled.catalog);
  }
  await setStorage(STORAGE_KEYS.DURABLE_MODE_DIAGNOSTICS, {
    status: 'completed',
    marker: DURABLE_SEMANTIC_MODE_PIPELINE_ID,
    graphRevision: state.graph.currentRevision,
    ...clustered.diagnostics,
    ...reconciled.diagnostics,
    generatedAt: reconciled.catalog.generatedAt,
  });

  const storedMode = await getStorage<string>(STORAGE_KEYS.MODE, 'Default');
  let activeModeId = await getStorage<string>(STORAGE_KEYS.ACTIVE_MODE_ID, '');
  if (!activeModeId) {
    const migrated = storedMode.toLowerCase() === 'default'
      ? null
      : reconciled.catalog.modes.find((mode) => (
          mode.label.toLowerCase() === storedMode.toLowerCase()
        ));
    activeModeId = migrated?.id ?? (storedMode.toLowerCase() === 'default' ? 'default' : storedMode);
    await setStorage(STORAGE_KEYS.ACTIVE_MODE_ID, activeModeId);
  }

  const activeMode = resolveDurableMode(reconciled.catalog, activeModeId);
  if (activeMode && storedMode !== activeMode.label) {
    await setStorage(STORAGE_KEYS.MODE, activeMode.label);
    const tabs = await chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] });
    await Promise.all(tabs.map((tab) => tab.id
      ? chrome.tabs.sendMessage(tab.id, {
        type: 'MODE_CHANGED',
        payload: { mode: activeMode.label, modeId: activeMode.id },
      }).catch(() => undefined)
      : undefined));
  }

  return reconciled.catalog;
};

const resolveModeSelection = async (
  requested: string | null | undefined,
): Promise<{
  modeId: string;
  label: string;
  revision: number | null;
  memberLabels: string[];
}> => {
  const value = requested?.trim() || 'default';
  if (value.toLowerCase() === 'default') {
    return { modeId: 'default', label: 'Default', revision: null, memberLabels: [] };
  }
  const catalog = await getStorage<DurableSemanticModeCatalog | null>(
    STORAGE_KEYS.DURABLE_MODE_CATALOG,
    null,
  );
  const byId = resolveDurableMode(catalog, value);
  if (byId) return {
    modeId: byId.id,
    label: byId.label,
    revision: byId.revision,
    memberLabels: byId.members.map((member) => member.label),
  };
  const byLabel = catalog?.modes.find((mode) => mode.label.toLowerCase() === value.toLowerCase());
  if (byLabel) return {
    modeId: byLabel.id,
    label: byLabel.label,
    revision: byLabel.revision,
    memberLabels: byLabel.members.map((member) => member.label),
  };
  return { modeId: value, label: value, revision: null, memberLabels: [] };
};
let historyReconciliationReady: Promise<void> | null = null;
let privacyDisclosureAccepted = false;
let privacyDisclosureReady: Promise<boolean> | null = null;
let lastPersistedTraceSignature = '';
let lastPersistedRankCacheSignature = '';
let rankSuccessStatePersisted = false;
const metadataEnrichmentInFlight = new Set<string>();
const metadataEnrichmentFailureUntil = new Map<string, number>();
const METADATA_ENRICHMENT_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;
const semanticRefreshInFlight = new Set<string>();
let conceptExtractionRefreshInFlight: Promise<ConceptExtractionRefreshResult> | null = null;
let semanticEpoch = 0;
let rankSemanticRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let rankSemanticRefreshQueuedAt = 0;
let rankSemanticRefreshPending: {
  candidates: CandidatePoolItem[];
  mode: string;
  senderTabId: number | null;
} | null = null;
// Concept proposals are keyed by candidate input + model/pipeline identity, not
// graph revision. Only lifecycle/model-boundary changes invalidate in-flight
// concept generation.
let conceptExtractionEpoch = 0;

let candidatePoolMemory: CandidatePoolItem[] | null = null;
let candidatePoolIndexMemory: Map<string, CandidatePoolItem> | null = null;
let candidatePoolPersistQueue: Promise<void> = Promise.resolve();
let candidatePoolMemoryRevision = 0;
let videoStoreMemory: Record<string, VideoRecord> | null = null;
let videoStoreMemoryRevision = 0;
let semanticFeatureCacheMemory: Record<string, SemanticFeatureRecord> | null = null;
let semanticFeatureCacheMemoryRevision = 0;
let lastRankMemo: {
  state: Awaited<ReturnType<LocalPersonalAlgorithmStore['exportStateForRead']>>;
  mode: string;
  sourceFiltersSignature: string;
  activeModeId: string;
  activeModeRevision: number | null;
  durableModeSignature: string;
  feedbackSignature: string;
  candidateIdsSignature: string;
  candidatePoolRevision: number;
  videoStoreRevision: number;
  semanticFeatureRevision: number;
  feed: LocalFeedItem[];
} | null = null;

const getCandidatePoolCached = async (): Promise<CandidatePoolItem[]> => {
  if (candidatePoolMemory) return candidatePoolMemory;
  candidatePoolMemory = await getStorage<CandidatePoolItem[]>(
    STORAGE_KEYS.FEED_CANDIDATE_POOL,
    [],
  );
  candidatePoolMemoryRevision += 1;
  candidatePoolIndexMemory = new Map(
    candidatePoolMemory.map((candidate) => [candidate.external_id, candidate]),
  );
  return candidatePoolMemory;
};

const getCandidatePoolIndexCached = async (): Promise<Map<string, CandidatePoolItem>> => {
  await getCandidatePoolCached();
  if (!candidatePoolIndexMemory) {
    candidatePoolIndexMemory = new Map(
      (candidatePoolMemory ?? []).map((candidate) => [candidate.external_id, candidate]),
    );
  }
  return candidatePoolIndexMemory;
};

const persistCandidatePoolCached = async (
  pool: CandidatePoolItem[],
  awaitWrite = true,
): Promise<void> => {
  candidatePoolMemory = pool;
  candidatePoolMemoryRevision += 1;
  lastRankMemo = null;
  candidatePoolIndexMemory = new Map(
    pool.map((candidate) => [candidate.external_id, candidate]),
  );
  candidatePoolPersistQueue = candidatePoolPersistQueue
    .catch(() => undefined)
    .then(() => setStorage(STORAGE_KEYS.FEED_CANDIDATE_POOL, pool));
  if (awaitWrite) await candidatePoolPersistQueue;
};

const getVideoStoreCached = async (): Promise<Record<string, VideoRecord>> => {
  if (videoStoreMemory) return videoStoreMemory;
  videoStoreMemory = await getStorage<Record<string, VideoRecord>>(
    STORAGE_KEYS.VIDEO_STORE,
    {},
  );
  videoStoreMemoryRevision += 1;
  return videoStoreMemory;
};

const persistVideoStoreCached = async (store: Record<string, VideoRecord>): Promise<void> => {
  videoStoreMemory = store;
  videoStoreMemoryRevision += 1;
  lastRankMemo = null;
  await setStorage(STORAGE_KEYS.VIDEO_STORE, store);
};

const getSemanticFeatureCacheCached = async (): Promise<Record<string, SemanticFeatureRecord>> => {
  if (semanticFeatureCacheMemory) return semanticFeatureCacheMemory;
  semanticFeatureCacheMemory = await getStorage<Record<string, SemanticFeatureRecord>>(
    STORAGE_KEYS.SEMANTIC_FEATURE_CACHE,
    {},
  );
  semanticFeatureCacheMemoryRevision += 1;
  return semanticFeatureCacheMemory;
};

const persistSemanticFeatureCacheCached = async (
  cache: Record<string, SemanticFeatureRecord>,
): Promise<void> => {
  semanticFeatureCacheMemory = cache;
  semanticFeatureCacheMemoryRevision += 1;
  lastRankMemo = null;
  await setStorage(STORAGE_KEYS.SEMANTIC_FEATURE_CACHE, cache);
};

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
  'REFRESH_SEMANTICS',
  'REFRESH_CONCEPT_EXTRACTION',
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
  const existing = await getVideoStoreCached();
  const now = Date.now();
  const missing = candidates
    .filter((candidate) => {
      const record = existing[candidate.external_id];
      return needsYoutubeMetadataRefresh(record, now, METADATA_REFRESH_MS)
        && !metadataEnrichmentInFlight.has(candidate.external_id)
        && (metadataEnrichmentFailureUntil.get(candidate.external_id) ?? 0) <= now;
    })
    .slice(0, MAX_METADATA_ENRICHMENTS_PER_SCAN);
  if (missing.length === 0) return [];
  missing.forEach((candidate) => metadataEnrichmentInFlight.add(candidate.external_id));

  const enrichOne = async (candidate: PageCandidate): Promise<VideoRecord | null> => {
    const acquisition = youtubeConnector.acquisition;
    if (!acquisition) return null;
    const enriched = await acquisition.enrich(candidate);
    if (!enriched) {
      metadataEnrichmentFailureUntil.set(
        candidate.external_id,
        Date.now() + METADATA_ENRICHMENT_FAILURE_COOLDOWN_MS,
      );
      return null;
    }
    metadataEnrichmentFailureUntil.delete(candidate.external_id);
    return {
      ...candidate,
      ...enriched,
      external_id: candidate.external_id,
      title: enriched.title || candidate.title,
      enrichedAt: new Date().toISOString(),
    } satisfies VideoRecord;
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
    await persistVideoStoreCached(Object.fromEntries(entries));
    return enriched;
  } finally {
    missing.forEach((candidate) => metadataEnrichmentInFlight.delete(candidate.external_id));
  }
}

async function hydrateCandidatePool(pool: CandidatePoolItem[]): Promise<CandidatePoolItem[]> {
  const store = await getVideoStoreCached();
  return pool.map((candidate) => {
    const record = store[candidate.external_id];
    if (!record) return candidate;
    return { ...candidate, ...record, external_id: candidate.external_id, title: record.title || candidate.title };
  });
}

async function mergeCandidatePool(
  candidates: PageCandidate[],
  options: { deferPersistence?: boolean } = {},
): Promise<CandidatePoolItem[]> {
  const existing = await getCandidatePoolCached();
  const byId = await getCandidatePoolIndexCached();

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
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

  if (!changed) return existing;

  const pool = [...byId.values()]
    .sort(
      (a, b) =>
        new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
    )
    .slice(0, MAX_CANDIDATE_POOL_SIZE);

  if (pool.length !== byId.size) {
    candidatePoolIndexMemory = new Map(
      pool.map((candidate) => [candidate.external_id, candidate]),
    );
  }
  await persistCandidatePoolCached(pool, options.deferPersistence !== true);
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
  let channelIds = selectYoutubeRssChannelIds(Object.values(store));

  // Older cached metadata can be fresh but lack channel IDs. Seed channel IDs
  // directly in the extension worker from the bounded candidate reservoir.
  if (channelIds.length === 0) {
    const candidatePool = await getStorage<CandidatePoolItem[]>(STORAGE_KEYS.FEED_CANDIDATE_POOL, []);
    if (candidatePool.length > 0) {
      await enrichVideos(candidatePool);
      store = await getStorage<Record<string, VideoRecord>>(STORAGE_KEYS.VIDEO_STORE, {});
      channelIds = selectYoutubeRssChannelIds(Object.values(store));
    }
  }

  if (channelIds.length === 0) {
    const diagnostics: RetrievalDiagnostics = {
      ...previous,
      lastRssSyncAt: new Date(nowMs).toISOString(),
      nextRssAllowedAt: null,
      lastError: 'No YouTube channel IDs are available yet. Refresh discovery after MyAlgo has observed a few videos.',
    };
    const persistedDiagnostics = await persistRetrievalDiagnostics(diagnostics);
    return { diagnostics: persistedDiagnostics, changed: false };
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
  let enrichedCount = 0;
  if (uniqueFetched.length > 0) {
    await mergeCandidatePool(uniqueFetched);

    // RSS is intentionally lightweight. Canonical watch-page enrichment
    // supplies the richer metadata used by classification/scoring.
    enrichedCount = (await enrichVideos(uniqueFetched.slice(0, 18))).length;
  }

  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;
  const consecutiveFailures = results.length > 0 && succeeded === 0
    ? (previous.rssConsecutiveFailures ?? 0) + 1
    : 0;
  const diagnostics: RetrievalDiagnostics = {
    ...previous,
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
  const persistedDiagnostics = await persistRetrievalDiagnostics(diagnostics);
  console.info('[MyAlgo] retrieval refresh', {
    mechanism: 'rss',
    channels: persistedDiagnostics.rssChannelsConsidered,
    succeeded: persistedDiagnostics.rssFeedsSucceeded,
    failed: persistedDiagnostics.rssFeedsFailed,
    fetched: persistedDiagnostics.rssCandidatesFetched,
    added: persistedDiagnostics.rssCandidatesAdded,
    deduplicated: persistedDiagnostics.rssCandidatesDeduplicated,
  });
  return { diagnostics: persistedDiagnostics, changed: addedCount > 0 || enrichedCount > 0 };
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

  const [
    state,
    storedMode,
    activeModeId,
    durableModeCatalog,
  ] = await Promise.all([
    personalAlgorithmStore.exportState(),
    getStorage<string>(STORAGE_KEYS.MODE, 'Default'),
    getStorage<string>(STORAGE_KEYS.ACTIVE_MODE_ID, 'default'),
    getStorage<DurableSemanticModeCatalog | null>(
      STORAGE_KEYS.DURABLE_MODE_CATALOG,
      null,
    ),
  ]);
  const activeDurableMode = resolveDurableMode(durableModeCatalog, activeModeId);
  const effectiveModeLabel = modeOverride ?? activeDurableMode?.label ?? storedMode;
  const baseProfile = buildGraphRetrievalProfile(state);
  const profile = activeDurableMode
    ? applyDurableModeToRetrievalProfile(baseProfile, activeDurableMode)
    : applyModeToRetrievalProfile(baseProfile, effectiveModeLabel);
  const retrievalRevision = buildGraphRetrievalRevision(state);
  const modeRevisionTag = activeDurableMode
    ? `${activeDurableMode.id}:r${activeDurableMode.revision}`
    : effectiveModeLabel.toLowerCase();
  const plannedQueries = buildRecommendationQueryPlans(
    profile,
    activeDurableMode ? 16 : 8,
    `${retrievalRevision}:mode-${modeRevisionTag}`,
    [],
    [],
    true,
  );
  const priorityModeTopics = activeDurableMode
    ? [...activeDurableMode.members]
        .sort((left, right) => (
          right.weight - left.weight
          || left.canonicalId.localeCompare(right.canonicalId)
        ))
        .map((member) => member.label)
    : [];
  const plans = selectWebSearchPlans(
    plannedQueries,
    4,
    priorityModeTopics,
  );

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
    const persistedDiagnostics = await persistRetrievalDiagnostics(diagnostics);
    return { diagnostics: persistedDiagnostics, changed: false };
  }

  const existingPool = await getStorage<CandidatePoolItem[]>(STORAGE_KEYS.FEED_CANDIDATE_POOL, []);
  const existingIds = new Set(existingPool.map((item) => item.external_id));
  const acquiredAt = new Date(nowMs).toISOString();
  const provider = youtubeConnector.acquisition?.search;
  if (!provider) {
    const diagnostics = {
      ...previous,
      lastWebSearchAt: new Date(nowMs).toISOString(),
      nextWebSearchAllowedAt: null,
      lastError: 'The active connector does not support search acquisition.',
    };
    const persistedDiagnostics = await persistRetrievalDiagnostics(diagnostics);
    return { diagnostics: persistedDiagnostics, changed: false };
  }

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
  let enrichedCount = 0;
  if (unique.length > 0) {
    await mergeCandidatePool(unique);
    // Search snippets are discovery-only metadata. Canonical YouTube watch-page
    // enrichment supplies the richer metadata used by classification/scoring.
    enrichedCount = (await enrichVideos(unique.slice(0, 18))).length;
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
  const persistedDiagnostics = await persistRetrievalDiagnostics(diagnostics);

  console.info('[MyAlgo] web-search refresh', {
    provider: provider.id,
    mode: effectiveModeLabel,
    modeId: activeDurableMode?.id ?? null,
    modeRevision: activeDurableMode?.revision ?? null,
    modeMembers: activeDurableMode?.members.map((member) => member.label) ?? [],
    plans: plans.length,
    planTexts: plans.map((plan) => plan.text),
    fetched: unique.length,
    added: addedCount,
    failed,
  });

  return { diagnostics: persistedDiagnostics, changed: addedCount > 0 };
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
      STORAGE_KEYS.FEED_REPLACEMENT_PERCENT,
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
      [STORAGE_KEYS.MODE]: firstInstall ? 'Default' : migrateStoredMode(current[STORAGE_KEYS.MODE]),
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
      [STORAGE_KEYS.FEED_REPLACEMENT_PERCENT]: current[STORAGE_KEYS.FEED_REPLACEMENT_PERCENT] ?? 0,
      [STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS]: current[STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS] ?? EMPTY_RETRIEVAL_DIAGNOSTICS,
      [STORAGE_KEYS.SEMANTIC_MODEL_MODE]: current[STORAGE_KEYS.SEMANTIC_MODEL_MODE] ?? 'hash',
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

const semanticFeatureKey = (
  externalId: string,
  inputHash: string,
  graphRevision: number,
  mode: string,
  modelVersion: string,
): string => [
  'graph-categories-v2',
  modelVersion,
  String(graphRevision),
  mode.trim().toLowerCase(),
  externalId,
  inputHash,
].map(encodeURIComponent).join(':');

async function hydrateSemanticScoreFeatures(
  state: Awaited<ReturnType<LocalPersonalAlgorithmStore['exportState']>>,
  candidates: CandidatePoolItem[],
  mode: string,
  semanticModelIdentities: string[],
  cache: Record<string, SemanticFeatureRecord> | null = null,
  durableModeCatalog: DurableSemanticModeCatalog | null = null,
): Promise<CandidatePoolItem[]> {
  const [resolvedCache, resolvedCatalog] = await Promise.all([
    cache ? Promise.resolve(cache) : getSemanticFeatureCacheCached(),
    durableModeCatalog
      ? Promise.resolve(durableModeCatalog)
      : getStorage<DurableSemanticModeCatalog | null>(
          STORAGE_KEYS.DURABLE_MODE_CATALOG,
          null,
        ),
  ]);
  const expectedModeCatalogSignature = durableModeCatalogSignature(resolvedCatalog);
  return candidates.map((candidate) => {
    const inputHash = semanticInputHash(buildCandidateEmbeddingText(candidate));
    const record = semanticModelIdentities
      .map((semanticModelIdentity) => resolvedCache[semanticFeatureKey(
        candidate.external_id,
        inputHash,
        state.graph.currentRevision,
        mode,
        semanticModelIdentity,
      )])
      .find((candidateRecord) => (
        candidateRecord
        && candidateRecord.modeAffinityPipelineId === DURABLE_MODE_AFFINITY_PIPELINE_ID
        && candidateRecord.modeCatalogSignature === expectedModeCatalogSignature
      ));
    if (!record) return candidate;
    return {
      ...candidate,
      semantic_graph_similarity: record.graphSimilarity,
      semantic_mode_similarity: record.modeSimilarity,
      semantic_model_version: record.modelVersion,
      semantic_graph_matches: record.graphMatches,
      semantic_category: record.category,
      semantic_category_confidence: record.categoryConfidence,
      semantic_category_scores: record.categoryScores,
      semantic_mode_affinities: record.modeAffinities ?? [],
    };
  });
}

async function runConceptExtractionCacheRefresh(
  state: Awaited<ReturnType<typeof personalAlgorithmStore.exportState>>,
  candidatePool: CandidatePoolItem[],
  enabled: boolean,
  conceptEpoch: number,
): Promise<ConceptExtractionRefreshResult> {
  const existing = await getStorage<Record<string, ConceptExtractionCacheRecord>>(
    STORAGE_KEYS.CONCEPT_EXTRACTION_CACHE,
    {},
  );
  const modelVersion = `${CONCEPT_EXTRACTION_MODEL_ID}@${CONCEPT_EXTRACTION_MODEL_VERSION}@${CONCEPT_EXTRACTION_PIPELINE_VERSION}`;
  const interactionSupportedIds = new Set(
    state.evidence
      .filter((record) => (
        record.evidence.kind === 'interaction'
        && ['clicked', 'watched', 'saved', 'shared'].includes(record.evidence.interaction)
      ))
      .map((record) => (
        `${record.evidence.content.source}:${record.evidence.content.externalId}`
      )),
  );

  const supportedCandidates = candidatePool
    .filter((candidate) => interactionSupportedIds.has(`youtube:${candidate.external_id}`))
    .sort((left, right) => (
      right.lastSeenAt.localeCompare(left.lastSeenAt)
      || left.external_id.localeCompare(right.external_id)
    ));

  const validByExternalId = new Map<string, string[]>();
  const needingExtraction: CandidatePoolItem[] = [];
  let cacheHits = 0;

  for (const candidate of supportedCandidates) {
    const inputHash = conceptExtractionInputHash(candidate);
    const cached = existing[candidate.external_id];
    if (cached?.inputHash === inputHash && cached.modelVersion === modelVersion) {
      validByExternalId.set(candidate.external_id, [...cached.concepts]);
      cacheHits += 1;
    } else {
      needingExtraction.push(candidate);
    }
  }

  let extracted = 0;
  let backend: string | null = null;
  let fallbackReason: string | null = null;

  if (enabled && needingExtraction.length > 0) {
    const batch = needingExtraction.slice(0, MAX_CONCEPT_EXTRACTIONS_PER_REFRESH);
    if (conceptEpoch === conceptExtractionEpoch && privacyDisclosureAccepted) {
      await setStorage(STORAGE_KEYS.CONCEPT_EXTRACTION_DIAGNOSTICS, {
        status: 'started',
        modelId: CONCEPT_EXTRACTION_MODEL_ID,
        modelVersion: CONCEPT_EXTRACTION_MODEL_VERSION,
        pipelineVersion: CONCEPT_EXTRACTION_PIPELINE_VERSION,
        generationEnabled: true,
        interactionSupportedCandidateCount: supportedCandidates.length,
        cacheHits,
        extracted: 0,
        pending: needingExtraction.length,
        requestedBatchSize: batch.length,
        cachedConceptCandidateCount: validByExternalId.size,
        backend: null,
        fallbackReason: null,
        generatedAt: new Date().toISOString(),
      });
    }
    try {
      const provider = createLocalConceptExtractionProvider();
      const modelStartedAt = performance.now();
      if (conceptEpoch === conceptExtractionEpoch && privacyDisclosureAccepted) {
        await setStorage(STORAGE_KEYS.CONCEPT_MODEL_STATUS, {
          status: 'queued',
          modelId: CONCEPT_EXTRACTION_MODEL_ID,
          modelVersion: CONCEPT_EXTRACTION_MODEL_VERSION,
          pipelineVersion: CONCEPT_EXTRACTION_PIPELINE_VERSION,
          inputCount: batch.length,
          backend: null,
          updatedAt: new Date().toISOString(),
        });
      }
      const result = await provider.verify(batch.map(buildConceptVerificationInput));
      backend = result.backend;
      if (conceptEpoch === conceptExtractionEpoch && privacyDisclosureAccepted) {
        await setStorage(STORAGE_KEYS.CONCEPT_MODEL_STATUS, {
          status: 'ready',
          modelId: CONCEPT_EXTRACTION_MODEL_ID,
          modelVersion: CONCEPT_EXTRACTION_MODEL_VERSION,
          pipelineVersion: CONCEPT_EXTRACTION_PIPELINE_VERSION,
          inputCount: batch.length,
          completedItems: batch.length,
          backend: result.backend,
          elapsedMs: Math.round(performance.now() - modelStartedAt),
          updatedAt: new Date().toISOString(),
        });
      }
      const generatedAt = new Date().toISOString();

      batch.forEach((candidate, index) => {
        const concepts = result.concepts[index] ?? [];
        const record: ConceptExtractionCacheRecord = {
          externalId: candidate.external_id,
          inputHash: conceptExtractionInputHash(candidate),
          modelVersion,
          concepts: [...concepts],
          backend: result.backend,
          generatedAt,
        };
        existing[candidate.external_id] = record;
        validByExternalId.set(candidate.external_id, [...concepts]);
        extracted += 1;
      });

      const bounded = Object.fromEntries(
        Object.entries(existing)
          .sort(([, left], [, right]) => right.generatedAt.localeCompare(left.generatedAt))
          .slice(0, MAX_CONCEPT_EXTRACTION_CACHE),
      );
      if (conceptEpoch === conceptExtractionEpoch && privacyDisclosureAccepted) {
        await setStorage(STORAGE_KEYS.CONCEPT_EXTRACTION_CACHE, bounded);
      }
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : 'Local concept verification failed.';
      if (conceptEpoch === conceptExtractionEpoch && privacyDisclosureAccepted) {
        await setStorage(STORAGE_KEYS.CONCEPT_MODEL_STATUS, {
          status: 'error',
          modelId: CONCEPT_EXTRACTION_MODEL_ID,
          modelVersion: CONCEPT_EXTRACTION_MODEL_VERSION,
          pipelineVersion: CONCEPT_EXTRACTION_PIPELINE_VERSION,
          inputCount: batch.length,
          backend,
          error: fallbackReason,
          updatedAt: new Date().toISOString(),
        });
      }
      console.warn('[MyAlgo] local concept verification unavailable; retaining metadata concepts', error);
    }
  }

  const diagnostics = {
    status: fallbackReason ? 'fallback' : (enabled ? 'completed' : 'cache_only'),
    modelId: CONCEPT_EXTRACTION_MODEL_ID,
    modelVersion: CONCEPT_EXTRACTION_MODEL_VERSION,
    pipelineVersion: CONCEPT_EXTRACTION_PIPELINE_VERSION,
    generationEnabled: enabled,
    interactionSupportedCandidateCount: supportedCandidates.length,
    cacheHits,
    extracted,
    pending: Math.max(0, needingExtraction.length - extracted),
    cachedConceptCandidateCount: validByExternalId.size,
    backend,
    fallbackReason,
    generatedAt: new Date().toISOString(),
  };
  if (enabled && conceptEpoch === conceptExtractionEpoch && privacyDisclosureAccepted) {
    await setStorage(STORAGE_KEYS.CONCEPT_EXTRACTION_DIAGNOSTICS, diagnostics);
  }

  return {
    // "enabled" controls new generation only. Cached concepts must remain
    // authoritative inputs during the embedding drain; otherwise a cache-only
    // pass would rematerialize the older metadata taxonomy and churn revisions.
    conceptsByExternalId: validByExternalId,
    diagnostics,
  };
}

async function refreshConceptExtractionCache(
  state: Awaited<ReturnType<typeof personalAlgorithmStore.exportState>>,
  candidatePool: CandidatePoolItem[],
  enabled: boolean,
): Promise<ConceptExtractionRefreshResult> {
  const conceptEpoch = conceptExtractionEpoch;
  if (!enabled) {
    return runConceptExtractionCacheRefresh(state, candidatePool, false, conceptEpoch);
  }
  if (conceptExtractionRefreshInFlight) {
    return conceptExtractionRefreshInFlight;
  }

  const pending = runConceptExtractionCacheRefresh(
    state,
    candidatePool,
    true,
    conceptEpoch,
  );
  conceptExtractionRefreshInFlight = pending;
  try {
    return await pending;
  } finally {
    if (conceptExtractionRefreshInFlight === pending) {
      conceptExtractionRefreshInFlight = null;
    }
  }
}

async function refreshSemanticConceptGraph(
  allowModelExtraction = true,
): Promise<{
  changed: boolean;
  diagnostics: Record<string, unknown>;
}> {
  const [initialState, initialCandidatePool, semanticModelMode, conceptModelStatus] = await Promise.all([
    personalAlgorithmStore.exportState(),
    getStorage<CandidatePoolItem[]>(STORAGE_KEYS.FEED_CANDIDATE_POOL, []),
    getSemanticModelMode(),
    getStorage<Record<string, unknown> | null>(STORAGE_KEYS.CONCEPT_MODEL_STATUS, null),
  ]);
  const conceptStatusUpdatedAt = typeof conceptModelStatus?.updatedAt === 'string'
    ? Date.parse(conceptModelStatus.updatedAt)
    : Number.NaN;
  const conceptFailureCooldownActive = conceptModelStatus?.status === 'error'
    && Number.isFinite(conceptStatusUpdatedAt)
    && Date.now() - conceptStatusUpdatedAt < CONCEPT_EXTRACTION_RETRY_COOLDOWN_MS;
  const generationEnabled = allowModelExtraction
    && semanticModelMode === 'neural'
    && !conceptFailureCooldownActive;
  const generation = await refreshConceptExtractionCache(
    initialState,
    initialCandidatePool,
    generationEnabled,
  );

  // Generation may take long enough for evidence/candidate state to advance.
  // Concept cache entries remain valid by input hash/model identity, but graph
  // reconciliation must always use a fresh post-generation snapshot.
  const [state, candidatePool] = generationEnabled
    ? await Promise.all([
        personalAlgorithmStore.exportState(),
        getStorage<CandidatePoolItem[]>(STORAGE_KEYS.FEED_CANDIDATE_POOL, []),
      ])
    : [initialState, initialCandidatePool];
  const extraction = generationEnabled
    ? await refreshConceptExtractionCache(state, candidatePool, false)
    : generation;

  const projection = buildSemanticConceptMaterialization(
    state,
    candidatePool.map((candidate) => ({
      external_id: candidate.external_id,
      source: 'youtube',
      topics: candidate.topics,
      model_topics: extraction.conceptsByExternalId.get(candidate.external_id),
      content_type: candidate.content_type,
    })),
    {
      minimumContentSupport: 2,
      maxProposals: 64,
      maxSupportEdgesPerProposal: 24,
      maxCandidateTopics: 16,
    },
  );

  const reconciled = await personalAlgorithmStore.reconcileDerivedGraphProjection({
    marker: SEMANTIC_CONCEPT_MATERIALIZER_ID,
    nodes: projection.nodes,
    edges: projection.edges,
  });

  if (reconciled.changed) {
    // Graph revision invalidates semantic feature keys. Prevent older in-flight
    // refreshes from persisting against the newly materialized graph.
    semanticEpoch += 1;
    semanticRefreshInFlight.clear();
  }

  const modeState = await personalAlgorithmStore.exportState();
  const durableModes = await refreshDurableModeCatalog(modeState);

  const diagnostics = {
    status: 'completed',
    marker: SEMANTIC_CONCEPT_MATERIALIZER_ID,
    ...projection.diagnostics,
    changed: reconciled.changed,
    graphRevision: reconciled.graphRevision,
    materializedNodeCount: reconciled.nodeCount,
    materializedEdgeCount: reconciled.edgeCount,
    preservedReferencedNodeCount: reconciled.preservedReferencedNodeCount,
    modelExtractionStatus: generation.diagnostics.status,
    modelExtractionSuppressedReason: conceptFailureCooldownActive
      ? 'recent_verifier_failure'
      : null,
    modelExtractedCandidateCount: generation.diagnostics.extracted,
    modelCachedCandidateCount: extraction.diagnostics.cachedConceptCandidateCount,
    modelPendingCandidateCount: extraction.diagnostics.pending,
    durableModeCount: durableModes.modes.length,
    activeDurableModeCount: durableModes.modes.filter((mode) => mode.active).length,
    generatedAt: new Date().toISOString(),
  };
  await setStorage(STORAGE_KEYS.SEMANTIC_CONCEPT_DIAGNOSTICS, diagnostics);
  return { changed: reconciled.changed, diagnostics };
}

async function refreshSemanticScoreFeatures(
  candidates: CandidatePoolItem[],
  mode: string,
  // Scoring must not await the much slower q8 concept verifier. Verified
  // concept generation is scheduled separately once the current neural
  // candidate-affinity slice has caught up.
  allowConceptExtraction = false,
): Promise<{ changed: number; diagnostics: Record<string, unknown> | null }> {
  if (candidates.length === 0) {
    const diagnostics = {
      status: 'skipped',
      reason: 'no_candidates',
      mode,
      candidateCount: 0,
      generatedAt: new Date().toISOString(),
    };
    await setStorage(STORAGE_KEYS.SEMANTIC_DIAGNOSTICS, diagnostics);
    return { changed: 0, diagnostics };
  }
  const conceptMaterialization = await refreshSemanticConceptGraph(allowConceptExtraction);
  const state = await personalAlgorithmStore.exportState();
  const durableModeCatalog = await refreshDurableModeCatalog(state);
  const activeModeId = await getStorage<string>(STORAGE_KEYS.ACTIVE_MODE_ID, 'default');
  const expectedModeCatalogSignature = durableModeCatalogSignature(durableModeCatalog);
  const requestedContext = await getSemanticProviderContext();
  const refreshKey = `${state.graph.currentRevision}:${mode.trim().toLowerCase()}:${requestedContext.semanticModelIdentity}`;
  if (semanticRefreshInFlight.has(refreshKey)) {
    return {
      changed: 0,
      diagnostics: {
        status: 'skipped',
        reason: 'refresh_in_flight',
        mode,
        graphRevision: state.graph.currentRevision,
        requestedSemanticModelMode: requestedContext.semanticModelMode,
        modelVersion: requestedContext.semanticModelIdentity,
        candidateCount: candidates.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }
  semanticRefreshInFlight.add(refreshKey);
  const refreshEpoch = semanticEpoch;
  await setStorage(STORAGE_KEYS.SEMANTIC_DIAGNOSTICS, {
    status: 'started',
    mode,
    graphRevision: state.graph.currentRevision,
    requestedSemanticModelMode: requestedContext.semanticModelMode,
    modelVersion: requestedContext.semanticModelIdentity,
    candidateCount: candidates.length,
    conceptNodeCount: Number(conceptMaterialization.diagnostics.materializedNodeCount ?? 0),
    conceptEdgeCount: Number(conceptMaterialization.diagnostics.materializedEdgeCount ?? 0),
    conceptGraphChanged: conceptMaterialization.changed,
    generatedAt: new Date().toISOString(),
  });
  const scopedEmbeddingCache = {
    get: (key: string) => refreshEpoch === semanticEpoch
      ? semanticEmbeddingCache.get(key)
      : Promise.resolve(null),
    set: (key: string, record: Parameters<typeof semanticEmbeddingCache.set>[1]) => refreshEpoch === semanticEpoch
      ? semanticEmbeddingCache.set(key, record)
      : Promise.resolve(),
    flush: () => refreshEpoch === semanticEpoch
      ? semanticEmbeddingCache.flush?.() ?? Promise.resolve()
      : Promise.resolve(),
  };

  try {
    const startedAt = performance.now();
    const existing = await getSemanticFeatureCacheCached();
    const fallbackIdentity = semanticProviderIdentity('hash');
    const fallbackModelIdentity = `${fallbackIdentity.modelId}@${fallbackIdentity.modelVersion}`;
    let recentFallbackCoverageCount = 0;
    const candidatesNeedingRequestedFeatures = candidates.filter((candidate) => {
      const inputHash = semanticInputHash(buildCandidateEmbeddingText(candidate));
      const key = semanticFeatureKey(
        candidate.external_id,
        inputHash,
        state.graph.currentRevision,
        mode,
        requestedContext.semanticModelIdentity,
      );
      const cached = existing[key];
      const requestedRecordValid = Boolean(
        cached
        && Array.isArray(cached.modeAffinities)
        && cached.modeAffinityPipelineId === DURABLE_MODE_AFFINITY_PIPELINE_ID
        && cached.modeCatalogSignature === expectedModeCatalogSignature
      );
      if (requestedRecordValid) return false;

      if (requestedContext.semanticModelMode === 'neural') {
        const fallbackKey = semanticFeatureKey(
          candidate.external_id,
          inputHash,
          state.graph.currentRevision,
          mode,
          fallbackModelIdentity,
        );
        const fallbackRecord = existing[fallbackKey];
        const fallbackGeneratedAt = fallbackRecord?.generatedAt
          ? Date.parse(fallbackRecord.generatedAt)
          : Number.NaN;
        const recentFallbackCoversRequest = Boolean(
          fallbackRecord
          && Array.isArray(fallbackRecord.modeAffinities)
          && fallbackRecord.modeAffinityPipelineId === DURABLE_MODE_AFFINITY_PIPELINE_ID
          && fallbackRecord.modeCatalogSignature === expectedModeCatalogSignature
          && fallbackRecord.requestedModelVersion === requestedContext.semanticModelIdentity
          && fallbackRecord.fallbackReason
          && Number.isFinite(fallbackGeneratedAt)
          && Date.now() - fallbackGeneratedAt < NEURAL_FALLBACK_RETRY_COOLDOWN_MS
        );
        if (recentFallbackCoversRequest) {
          recentFallbackCoverageCount += 1;
          return false;
        }
      }

      // Missing affinity metadata, catalog mismatch, or an expired neural
      // fallback record means this candidate needs a fresh semantic pass.
      return true;
    });
    const semanticCandidates = requestedContext.semanticModelMode === 'neural'
      ? candidatesNeedingRequestedFeatures.slice(0, MAX_NEURAL_CANDIDATES_PER_REFRESH)
      : candidates;

    await setStorage(STORAGE_KEYS.SEMANTIC_DIAGNOSTICS, {
      status: 'started',
      phase: 'embedding_slice',
      mode,
      graphRevision: state.graph.currentRevision,
      requestedSemanticModelMode: requestedContext.semanticModelMode,
      modelVersion: requestedContext.semanticModelIdentity,
      candidateCount: semanticCandidates.length,
      modeAffinityPipelineId: DURABLE_MODE_AFFINITY_PIPELINE_ID,
      modeCatalogSignature: expectedModeCatalogSignature,
      recentFallbackCoverageCount,
      neuralFallbackRetryCooldownMs: NEURAL_FALLBACK_RETRY_COOLDOWN_MS,
      totalCandidateCount: candidates.length,
      pendingCandidateCount: Math.max(
        0,
        candidatesNeedingRequestedFeatures.length - semanticCandidates.length,
      ),
      generatedAt: new Date().toISOString(),
    });

    if (requestedContext.semanticModelMode === 'neural' && semanticCandidates.length === 0) {
      const diagnostics = {
        status: 'completed',
        modelId: requestedContext.provider.modelId,
        modelVersion: requestedContext.provider.modelVersion,
        graphNodesConsidered: 0,
        graphEmbeddingsComputed: 0,
        graphEmbeddingsFromCache: 0,
        candidateEmbeddingsComputed: 0,
        candidateEmbeddingsFromCache: 0,
        candidateCount: 0,
        totalCandidateCount: candidates.length,
        pendingCandidateCount: 0,
        modeNodeCount: 0,
        requestedSemanticModelMode: requestedContext.semanticModelMode,
        semanticModelMode: requestedContext.semanticModelMode,
        execution: requestedContext.provider.execution,
        fallbackReason: recentFallbackCoverageCount > 0
          ? 'Recent neural fallback records are in retry cooldown.'
          : null,
        recentFallbackCoverageCount,
        neuralFallbackRetryCooldownMs: NEURAL_FALLBACK_RETRY_COOLDOWN_MS,
        mode,
        graphRevision: state.graph.currentRevision,
        elapsedMs: Math.round(performance.now() - startedAt),
        embeddingCacheSize: await semanticEmbeddingCache.size(),
        featureCacheSize: Object.keys(existing).length,
        changed: 0,
        generatedAt: new Date().toISOString(),
      };
      await setStorage(STORAGE_KEYS.SEMANTIC_DIAGNOSTICS, diagnostics);
      return { changed: 0, diagnostics };
    }

    let effectiveContext = requestedContext;
    let fallbackReason: string | null = null;
    let lastNeuralPhase: string | null = null;
    let lastNeuralStatus: Record<string, unknown> | null = null;
    let semantic;
    const reportEmbeddingPhase = async (
      phase: 'graph_embeddings' | 'mode_seed' | 'candidate_embeddings' | 'embedding_cache_flush',
      inputCount: number,
    ) => {
      if (refreshEpoch !== semanticEpoch) return;
      if (effectiveContext.semanticModelMode === 'neural') lastNeuralPhase = phase;
      await setStorage(STORAGE_KEYS.SEMANTIC_DIAGNOSTICS, {
        status: 'started',
        phase,
        inputCount,
        mode,
        graphRevision: state.graph.currentRevision,
        requestedSemanticModelMode: requestedContext.semanticModelMode,
        neuralBatchSize: requestedContext.neuralBatchSize,
        semanticModelMode: effectiveContext.semanticModelMode,
        modelVersion: effectiveContext.semanticModelIdentity,
        candidateCount: semanticCandidates.length,
        modeAffinityPipelineId: DURABLE_MODE_AFFINITY_PIPELINE_ID,
        modeCatalogSignature: expectedModeCatalogSignature,
        totalCandidateCount: candidates.length,
        pendingCandidateCount: Math.max(0, candidatesNeedingRequestedFeatures.length - semanticCandidates.length),
        conceptNodeCount: Number(conceptMaterialization.diagnostics.materializedNodeCount ?? 0),
        conceptEdgeCount: Number(conceptMaterialization.diagnostics.materializedEdgeCount ?? 0),
        conceptGraphChanged: conceptMaterialization.changed,
        generatedAt: new Date().toISOString(),
      });
    };
    try {
      semantic = await enrichCandidatesWithSemanticReranking(
        state,
        semanticCandidates,
        mode,
        requestedContext.provider,
        scopedEmbeddingCache,
        {
          maxGraphNodes: 64,
          minimumModeNodeSimilarity: 0.15,
          onEmbeddingPhase: reportEmbeddingPhase,
        },
      );
    } catch (error) {
      if (requestedContext.semanticModelMode !== 'neural') throw error;
      fallbackReason = error instanceof Error ? error.message : 'Neural semantic provider failed.';
      const observedStatus = await getStorage<Record<string, unknown> | null>(
        STORAGE_KEYS.SEMANTIC_MODEL_STATUS,
        null,
      );
      if (observedStatus?.mode === 'neural') {
        lastNeuralStatus = Object.fromEntries(
          ['status', 'backend', 'inferenceBatch', 'inferenceBatchCount', 'completedBatches',
            'batchSize', 'inputCount', 'tokenMaxLength', 'elapsedMs', 'updatedAt']
            .filter((key) => observedStatus[key] !== undefined)
            .map((key) => [key, observedStatus[key]]),
        );
      }
      const fallbackProvider = createOffscreenEmbeddingProvider('hash');
      const fallbackIdentity = semanticProviderIdentity('hash');
      effectiveContext = {
        semanticModelMode: 'hash',
        neuralBatchSize: requestedContext.neuralBatchSize,
        provider: fallbackProvider,
        semanticModelIdentity: `${fallbackIdentity.modelId}@${fallbackIdentity.modelVersion}`,
      };
      semantic = await enrichCandidatesWithSemanticReranking(
        state,
        semanticCandidates,
        mode,
        fallbackProvider,
        scopedEmbeddingCache,
        {
          maxGraphNodes: 64,
          minimumModeNodeSimilarity: 0.15,
          onEmbeddingPhase: reportEmbeddingPhase,
        },
      );
      await setStorage(STORAGE_KEYS.SEMANTIC_MODEL_STATUS, {
        mode: 'neural',
        effectiveMode: 'hash',
        modelId: requestedContext.provider.modelId,
        backend: 'hash-fallback',
        status: 'fallback',
        error: fallbackReason,
        lastNeuralPhase,
        lastNeuralStatus,
        updatedAt: new Date().toISOString(),
      });
    }
    if (refreshEpoch !== semanticEpoch) return { changed: 0, diagnostics: null };
    const next = { ...existing };
    let changed = 0;
    const generatedAt = new Date().toISOString();

    semantic.candidates.forEach((candidate, index) => {
      const original = semanticCandidates[index];
      if (!original) return;
      const inputHash = semanticInputHash(buildCandidateEmbeddingText(original));
      const key = semanticFeatureKey(
        original.external_id,
        inputHash,
        state.graph.currentRevision,
        mode,
        effectiveContext.semanticModelIdentity,
      );
      const record: SemanticFeatureRecord = {
        externalId: original.external_id,
        inputHash,
        graphRevision: state.graph.currentRevision,
        mode,
        modelVersion: effectiveContext.semanticModelIdentity,
        requestedModelVersion: requestedContext.semanticModelIdentity,
        fallbackReason,
        graphSimilarity: Number(candidate.semantic_graph_similarity ?? 0),
        modeSimilarity: Number(candidate.semantic_mode_similarity ?? 0),
        category: candidate.semantic_category ?? null,
        categoryConfidence: Number(candidate.semantic_category_confidence ?? 0),
        categoryScores: candidate.semantic_category_scores ?? {},
        graphMatches: (candidate.semantic_graph_matches ?? []).slice(0, 3),
        modeAffinities: buildCandidateModeAffinities(
          candidate.semantic_graph_matches,
          durableModeCatalog,
          {
            includeModeIds: activeModeId === 'default' ? [] : [activeModeId],
          },
        ),
        modeAffinityPipelineId: DURABLE_MODE_AFFINITY_PIPELINE_ID,
        modeCatalogSignature: expectedModeCatalogSignature,
        generatedAt,
      };
      const previous = existing[key];
      if (
        !previous
        || Math.abs(previous.graphSimilarity - record.graphSimilarity) > 0.0001
        || Math.abs(previous.modeSimilarity - record.modeSimilarity) > 0.0001
        || JSON.stringify(previous.graphMatches ?? []) !== JSON.stringify(record.graphMatches)
        || JSON.stringify(previous.modeAffinities ?? []) !== JSON.stringify(record.modeAffinities)
        || previous.modeAffinityPipelineId !== record.modeAffinityPipelineId
        || previous.modeCatalogSignature !== record.modeCatalogSignature
        || previous.requestedModelVersion !== record.requestedModelVersion
        || previous.fallbackReason !== record.fallbackReason
      ) {
        changed += 1;
      }
      next[key] = record;
    });

    const bounded = Object.fromEntries(
      Object.entries(next)
        .sort(([, left], [, right]) => right.generatedAt.localeCompare(left.generatedAt))
        .slice(0, MAX_SEMANTIC_FEATURE_CACHE),
    );
    if (refreshEpoch !== semanticEpoch) return { changed: 0, diagnostics: null };
    await setStorage(STORAGE_KEYS.SEMANTIC_DIAGNOSTICS, {
      status: 'started',
      phase: 'semantic_feature_cache_write',
      inputCount: semanticCandidates.length,
      mode,
      graphRevision: state.graph.currentRevision,
      requestedSemanticModelMode: requestedContext.semanticModelMode,
      neuralBatchSize: requestedContext.neuralBatchSize,
      semanticModelMode: effectiveContext.semanticModelMode,
      modelVersion: effectiveContext.semanticModelIdentity,
      candidateCount: semanticCandidates.length,
      modeAffinityPipelineId: DURABLE_MODE_AFFINITY_PIPELINE_ID,
      modeCatalogSignature: expectedModeCatalogSignature,
      totalCandidateCount: candidates.length,
      pendingCandidateCount: Math.max(
        0,
        candidatesNeedingRequestedFeatures.length - semanticCandidates.length,
      ),
      featureCacheSize: Object.keys(bounded).length,
      generatedAt: new Date().toISOString(),
    });
    await persistSemanticFeatureCacheCached(bounded);

    const remainingPendingCandidateCount = Math.max(
      0,
      candidatesNeedingRequestedFeatures.length - semanticCandidates.length,
    );
    const diagnostics = {
      status: remainingPendingCandidateCount > 0 ? 'partial' : 'completed',
      phase: remainingPendingCandidateCount > 0 ? 'slice_completed' : 'complete',
      ...semantic.diagnostics,
      requestedSemanticModelMode: requestedContext.semanticModelMode,
      semanticModelMode: effectiveContext.semanticModelMode,
      execution: effectiveContext.provider.execution,
      fallbackReason,
      lastNeuralPhase,
      lastNeuralStatus,
      mode,
      graphRevision: state.graph.currentRevision,
      elapsedMs: Math.round(performance.now() - startedAt),
      embeddingCacheSize: await semanticEmbeddingCache.size(),
      featureCacheSize: Object.keys(bounded).length,
      modeAffinityPipelineId: DURABLE_MODE_AFFINITY_PIPELINE_ID,
      modeCatalogSignature: expectedModeCatalogSignature,
      recentFallbackCoverageCount,
      neuralFallbackRetryCooldownMs: NEURAL_FALLBACK_RETRY_COOLDOWN_MS,
      totalCandidateCount: candidates.length,
      pendingCandidateCount: remainingPendingCandidateCount,
      changed,
      conceptNodeCount: Number(conceptMaterialization.diagnostics.materializedNodeCount ?? 0),
      conceptEdgeCount: Number(conceptMaterialization.diagnostics.materializedEdgeCount ?? 0),
      conceptGraphChanged: conceptMaterialization.changed,
      conceptInteractionSupportedContentCount: Number(
        conceptMaterialization.diagnostics.interactionSupportedContentCount ?? 0,
      ),
      generatedAt,
    };
    if (refreshEpoch !== semanticEpoch) return { changed: 0, diagnostics: null };
    await setStorage(STORAGE_KEYS.SEMANTIC_DIAGNOSTICS, diagnostics);
    console.info('[MyAlgo] semantic enrichment', {
      model: semantic.diagnostics.modelVersion,
      requestedSemanticModelMode: requestedContext.semanticModelMode,
      semanticModelMode: effectiveContext.semanticModelMode,
      execution: effectiveContext.provider.execution,
      fallbackReason,
      mode,
      candidates: semantic.diagnostics.candidateCount,
      totalCandidates: candidates.length,
      pendingCandidates: Math.max(
        0,
        candidatesNeedingRequestedFeatures.length - semanticCandidates.length,
      ),
      graphNodes: semantic.diagnostics.graphNodesConsidered,
      modeNodes: semantic.diagnostics.modeNodeCount,
      conceptNodes: conceptMaterialization.diagnostics.materializedNodeCount,
      conceptEdges: conceptMaterialization.diagnostics.materializedEdgeCount,
      conceptGraphChanged: conceptMaterialization.changed,
      changed,
      elapsedMs: diagnostics.elapsedMs,
    });
    return { changed, diagnostics };
  } catch (error) {
    const diagnostics = {
      status: 'error',
      mode,
      graphRevision: state.graph.currentRevision,
      requestedSemanticModelMode: requestedContext.semanticModelMode,
      modelVersion: requestedContext.semanticModelIdentity,
      candidateCount: candidates.length,
      error: error instanceof Error ? error.message : 'Semantic enrichment failed.',
      generatedAt: new Date().toISOString(),
    };
    await setStorage(STORAGE_KEYS.SEMANTIC_DIAGNOSTICS, diagnostics);
    console.error('[MyAlgo] semantic enrichment failed', diagnostics);
    return { changed: 0, diagnostics };
  } finally {
    semanticRefreshInFlight.delete(refreshKey);
  }
}

async function rankLocalCandidates(
  candidates: CandidatePoolItem[],
  sourceFilters: FeedSourceFilters,
  mode: string,
): Promise<LocalFeedItem[]> {
  const [
    state,
    feedbackEvents,
    activeModeId,
    durableModeCatalog,
    semanticContext,
    semanticFeatureCache,
  ] = await Promise.all([
    personalAlgorithmStore.exportStateForRead(),
    getStorage<Array<{ kind: string; payload: unknown; recordedAt: string }>>(
      'personal-algorithm-local-events',
      [],
    ),
    getStorage<string>(STORAGE_KEYS.ACTIVE_MODE_ID, 'default'),
    getStorage<DurableSemanticModeCatalog | null>(
      STORAGE_KEYS.DURABLE_MODE_CATALOG,
      null,
    ),
    getSemanticProviderContext(),
    getSemanticFeatureCacheCached(),
  ]);
  const activeDurableMode = resolveDurableMode(durableModeCatalog, activeModeId);
  const sourceFiltersSignature = JSON.stringify(sourceFilters);
  const feedbackSignature = JSON.stringify(
    feedbackEvents
      .filter((event) => event.kind === 'feedback')
      .map((event) => [event.recordedAt, event.payload]),
  );
  const candidateIdsSignature = candidates
    .map((candidate) => candidate.external_id)
    .sort()
    .join('|');
  const durableModeSignature = durableModeCatalogSignature(durableModeCatalog);
  if (
    lastRankMemo
    && lastRankMemo.state === state
    && lastRankMemo.mode === mode
    && lastRankMemo.sourceFiltersSignature === sourceFiltersSignature
    && lastRankMemo.activeModeId === activeModeId
    && lastRankMemo.activeModeRevision === (activeDurableMode?.revision ?? null)
    && lastRankMemo.durableModeSignature === durableModeSignature
    && lastRankMemo.feedbackSignature === feedbackSignature
    && lastRankMemo.candidateIdsSignature === candidateIdsSignature
    && lastRankMemo.candidatePoolRevision === candidatePoolMemoryRevision
    && lastRankMemo.videoStoreRevision === videoStoreMemoryRevision
    && lastRankMemo.semanticFeatureRevision === semanticFeatureCacheMemoryRevision
  ) {
    return lastRankMemo.feed;
  }

  const feedbackSignals = buildLocalFeedbackSignals(
    feedbackEvents
      .filter((event) => event.kind === 'feedback')
      .map((event) => ({
        ...(event.payload as { contentItemId?: string; eventType?: string; channelId?: string | null }),
        recordedAt: event.recordedAt,
      })),
    state,
  );
  const { semanticModelMode, semanticModelIdentity } = semanticContext;
  const fallbackIdentity = semanticProviderIdentity('hash');
  const semanticModelIdentities = semanticModelMode === 'neural'
    ? [
        semanticModelIdentity,
        `${fallbackIdentity.modelId}@${fallbackIdentity.modelVersion}`,
      ]
    : [semanticModelIdentity];
  const candidatesWithSemanticFeatures = await hydrateSemanticScoreFeatures(
    state,
    candidates,
    mode,
    semanticModelIdentities,
    semanticFeatureCache,
    durableModeCatalog,
  );
  const ranked = scoreLocalCandidates(
    state,
    candidatesWithSemanticFeatures,
    mode,
    feedbackSignals,
    sourceFilters,
    activeDurableMode
      ? {
          id: activeDurableMode.id,
          label: activeDurableMode.label,
          revision: activeDurableMode.revision,
        }
      : null,
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
    void setStorage(STORAGE_KEYS.PERSONAL_ALGORITHM_LOCAL_TRACES, traces).catch((error) => {
      console.warn('[MyAlgo] deferred trace persistence failed', error);
    });
  }

  const feed = ranked.map(({ trace, ...item }) => {
    const groundedModeContributions = trace.modeContributions
      .filter((contribution) => (
        contribution.modeId
        && Number.isInteger(contribution.modeRevision)
        && contribution.canonicalId
      ))
      .sort((left, right) => (
        (left.canonicalId ?? '').localeCompare(right.canonicalId ?? '')
      ));
    const firstGroundedMode = groundedModeContributions[0];
    const modeGrounding = firstGroundedMode
      ? {
          modeId: firstGroundedMode.modeId!,
          modeRevision: firstGroundedMode.modeRevision!,
          total: Number(groundedModeContributions
            .reduce((sum, contribution) => sum + contribution.value, 0)
            .toFixed(2)),
          members: groundedModeContributions.map((contribution) => ({
            canonicalId: contribution.canonicalId!,
            label: contribution.label,
            value: contribution.value,
            sourceIds: contribution.sourceIds ?? [],
            evidenceIds: contribution.evidenceIds,
          })),
        }
      : null;

    const nodeLabelById = new Map(state.graph.nodes.map((node) => [node.id, node.label]));
    const matchedPaths = trace.matchedPaths.map((path) => ({
      nodeIds: path.nodeIds,
      nodeLabels: path.nodeIds.map((nodeId) => nodeLabelById.get(nodeId) ?? nodeId),
      edgeIds: path.edgeIds,
      evidenceIds: path.evidenceIds,
    }));

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
        ...(contribution.sourceId ? { sourceId: contribution.sourceId } : {}),
        ...(contribution.sourceIds?.length ? { sourceIds: contribution.sourceIds } : {}),
        ...(contribution.modeId ? { modeId: contribution.modeId } : {}),
        ...(Number.isInteger(contribution.modeRevision) ? { modeRevision: contribution.modeRevision } : {}),
        ...(contribution.canonicalId ? { canonicalId: contribution.canonicalId } : {}),
        evidenceIds: contribution.evidenceIds,
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
        policyRevision: trace.policyRevision,
        acquisitionMechanism: item.provenance?.mechanism ?? null,
        contributions,
        matchedPaths,
        modeGrounding,
      },
    };
  });

  lastRankMemo = {
    state,
    mode,
    sourceFiltersSignature,
    activeModeId,
    activeModeRevision: activeDurableMode?.revision ?? null,
    durableModeSignature,
    feedbackSignature,
    candidateIdsSignature,
    candidatePoolRevision: candidatePoolMemoryRevision,
    videoStoreRevision: videoStoreMemoryRevision,
    semanticFeatureRevision: semanticFeatureCacheMemoryRevision,
    feed,
  };
  return feed;
}

const normalizeModeRefreshText = (value: string | null | undefined): string => (
  value ?? ''
).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');

const prioritizeCandidatesForSelectedMode = (
  candidates: CandidatePoolItem[],
  labels: readonly string[],
): CandidatePoolItem[] => {
  const normalizedLabels = labels.map(normalizeModeRefreshText).filter(Boolean);
  if (normalizedLabels.length === 0) return candidates;

  const labelSignals = normalizedLabels.map((label) => ({
    label,
    tokens: label.split(' ').filter((part) => part.length >= 4),
  }));
  const scored = candidates.map((candidate) => {
    const text = normalizeModeRefreshText([
      candidate.title,
      candidate.channel_name,
      ...(candidate.topics ?? []),
    ].filter(Boolean).join(' '));
    let relevance = 0;
    for (const signal of labelSignals) {
      if (text.includes(signal.label)) relevance += 10;
      for (const token of signal.tokens) {
        if (text.includes(token)) relevance += 1;
      }
    }
    return { candidate, relevance };
  });

  return scored.sort((left, right) => (
    right.relevance - left.relevance
    || right.candidate.lastSeenAt.localeCompare(left.candidate.lastSeenAt)
    || left.candidate.external_id.localeCompare(right.candidate.external_id)
  )).map(({ candidate }) => candidate);
};

const refreshSelectedModeSemantics = async (
  selection: { modeId: string; label: string; revision: number | null; memberLabels: string[] },
  tabs: chrome.tabs.Tab[],
): Promise<void> => {
  if (selection.modeId === 'default') return;

  const pool = await getCandidatePoolCached();
  const prioritized = prioritizeCandidatesForSelectedMode(
    pool,
    [selection.label, ...selection.memberLabels],
  ).slice(0, MAX_RANK_WORKING_SET);
  const hydrated = await hydrateCandidatePool(prioritized);

  // Drain a few neural slices immediately on explicit user selection. This is
  // bounded so mode activation is responsive without monopolizing the worker;
  // ordinary rank-driven semantic refresh continues the remaining tail.
  for (let pass = 0; pass < 4; pass += 1) {
    const refresh = await refreshSemanticScoreFeatures(hydrated, selection.label);
    const pending = Number(refresh.diagnostics?.pendingCandidateCount ?? 0);
    if (refresh.changed > 0) {
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, {
            type: 'YOUTUBE_SEMANTICS_ENRICHED',
            payload: {
              count: refresh.changed,
              modeSelectionRefresh: true,
              pendingCandidateCount: pending,
            },
          }).catch(() => undefined)
        : undefined));
    }
    if (pending <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
};

const scheduleRankSemanticRefresh = (
  candidates: CandidatePoolItem[],
  mode: string,
  senderTabId: number | null,
): void => {
  const now = Date.now();
  if (!rankSemanticRefreshPending) rankSemanticRefreshQueuedAt = now;
  rankSemanticRefreshPending = { candidates, mode, senderTabId };
  if (rankSemanticRefreshTimer) clearTimeout(rankSemanticRefreshTimer);

  const queuedFor = now - rankSemanticRefreshQueuedAt;
  const delayMs = queuedFor >= 1500 ? 0 : 300;
  rankSemanticRefreshTimer = setTimeout(() => {
    const pending = rankSemanticRefreshPending;
    rankSemanticRefreshPending = null;
    rankSemanticRefreshTimer = null;
    rankSemanticRefreshQueuedAt = 0;
    if (!pending) return;

    void refreshSemanticScoreFeatures(pending.candidates, pending.mode).then(async (semanticRefresh) => {
      const pendingCandidateCount = Number(
        semanticRefresh.diagnostics?.pendingCandidateCount ?? 0,
      );
      if (pending.senderTabId && semanticRefresh.changed > 0) {
        await chrome.tabs.sendMessage(pending.senderTabId, {
          type: 'YOUTUBE_SEMANTICS_ENRICHED',
          payload: {
            count: semanticRefresh.changed,
            modelVersion: typeof semanticRefresh.diagnostics?.modelVersion === 'string'
              ? semanticRefresh.diagnostics.modelVersion
              : null,
            pendingCandidateCount,
          },
        }).catch(() => undefined);
      }

      if (
        semanticRefresh.diagnostics?.requestedSemanticModelMode === 'neural'
        && pendingCandidateCount === 0
      ) {
        void refreshSemanticConceptGraph(true).then(async (materialization) => {
          if (!materialization.changed || !pending.senderTabId) return;
          await chrome.tabs.sendMessage(pending.senderTabId, {
            type: 'YOUTUBE_SEMANTICS_ENRICHED',
            payload: {
              count: 0,
              conceptGraphChanged: true,
              graphRevision: materialization.diagnostics.graphRevision ?? null,
            },
          }).catch(() => undefined);
        }).catch((error) => {
          console.warn('[MyAlgo] deferred concept verification failed', error);
        });
      }
    }).catch((error) => {
      console.warn('[MyAlgo] asynchronous semantic enrichment failed', error);
    });
  }, delayMs);
};

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
      modeId?: string;
      algorithmId?: string;
      enabled?: boolean;
      contentItemId?: string;
      externalId?: string;
      eventType?: string;
      sourceFilters?: FeedSourceFilters;
      feedReplacementPercent?: number;
      retrievalSettings?: RetrievalSettings;
      modeSupply?: ModeSupplyDiagnostics | null;
      evidence?: unknown[];
      observations?: unknown[];
      metrics?: unknown;
      semanticModelMode?: SemanticModelMode;
      batchSize?: number;
      generate?: boolean;
    };
  };

  if (type === 'PERSONAL_ALGORITHM_HEALTH') {
    void Promise.all([
      getStorage(STORAGE_KEYS.ENABLED, false),
      getStorage(STORAGE_KEYS.MODE, 'Default'),
      getStorage(STORAGE_KEYS.SEMANTIC_MODEL_MODE, 'hash'),
      getStorage(STORAGE_KEYS.SEMANTIC_NEURAL_BATCH_SIZE, 1),
    ]).then(([enabled, mode, semanticModelMode, neuralBatchSize]) => sendResponse({
      ok: true,
      worker: 'ready',
      enabled,
      mode,
      semanticModelMode,
      neuralBatchSize,
    })).catch((error) => sendResponse({
      ok: false,
      worker: 'error',
      error: error instanceof Error ? error.message : 'Unable to read worker state.',
    }));
    return true;
  }

  if (type === 'CONCEPT_MODEL_STATUS') {
    if (!privacyDisclosureAccepted) {
      sendResponse({ ok: true, ignored: true });
      return false;
    }
    void setStorage(STORAGE_KEYS.CONCEPT_MODEL_STATUS, payload ?? null)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to persist concept model status.',
      }));
    return true;
  }

  if (type === 'SEMANTIC_MODEL_STATUS') {
    void setStorage(STORAGE_KEYS.SEMANTIC_MODEL_STATUS, payload ?? null)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to persist semantic model status.',
      }));
    return true;
  }

  if (type === 'SET_SEMANTIC_NEURAL_BATCH_SIZE') {
    void (async () => {
      const requested = Number(payload?.batchSize ?? 1);
      const batchSize = Math.max(1, Math.min(16, Math.floor(Number.isFinite(requested) ? requested : 1)));
      await setStorage(STORAGE_KEYS.SEMANTIC_NEURAL_BATCH_SIZE, batchSize);
      await setStorage(STORAGE_KEYS.SEMANTIC_MODEL_STATUS, {
        mode: await getSemanticModelMode(),
        status: 'configured',
        batchSize,
        updatedAt: new Date().toISOString(),
      });
      sendResponse({ ok: true, batchSize });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to update neural batch size.',
    }));
    return true;
  }

  if (type === 'SET_SEMANTIC_MODEL_MODE') {
    void (async () => {
      const semanticModelMode: SemanticModelMode = payload?.semanticModelMode === 'neural' ? 'neural' : 'hash';
      semanticEpoch += 1;
      conceptExtractionEpoch += 1;
      semanticRefreshInFlight.clear();
      if (rankSemanticRefreshTimer) clearTimeout(rankSemanticRefreshTimer);
      rankSemanticRefreshTimer = null;
      rankSemanticRefreshPending = null;
      rankSemanticRefreshQueuedAt = 0;
      conceptExtractionRefreshInFlight = null;
      await setStorage(STORAGE_KEYS.SEMANTIC_MODEL_MODE, semanticModelMode);
      await semanticEmbeddingCache.clear();
      await chrome.storage.local.remove([
        STORAGE_KEYS.SEMANTIC_FEATURE_CACHE,
        STORAGE_KEYS.SEMANTIC_DIAGNOSTICS,
        STORAGE_KEYS.SEMANTIC_MODEL_STATUS,
        STORAGE_KEYS.CONCEPT_EXTRACTION_DIAGNOSTICS,
        STORAGE_KEYS.CONCEPT_MODEL_STATUS,
      ]);
      const tabs = await chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, {
          type: 'PERSONAL_ALGORITHM_CHANGED',
          payload: { reason: 'semantic_model' },
        }).catch(() => undefined)
        : undefined));
      sendResponse({
        ok: true,
        semanticModelMode,
        model: semanticProviderIdentity(semanticModelMode),
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to update semantic model.',
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
      semanticEpoch += 1;
      conceptExtractionEpoch += 1;
      semanticRefreshInFlight.clear();
      if (rankSemanticRefreshTimer) clearTimeout(rankSemanticRefreshTimer);
      rankSemanticRefreshTimer = null;
      rankSemanticRefreshPending = null;
      rankSemanticRefreshQueuedAt = 0;
      conceptExtractionRefreshInFlight = null;
      metadataEnrichmentFailureUntil.clear();
      lastPersistedTraceSignature = '';
      lastPersistedRankCacheSignature = '';
      rankSuccessStatePersisted = false;
      candidatePoolMemory = null;
      candidatePoolIndexMemory = null;
      candidatePoolPersistQueue = Promise.resolve();
      candidatePoolMemoryRevision = 0;
      videoStoreMemory = null;
      videoStoreMemoryRevision = 0;
      semanticFeatureCacheMemory = null;
      semanticFeatureCacheMemoryRevision = 0;
      lastRankMemo = null;
      await chrome.storage.local.clear();
      await semanticEmbeddingCache.clear();
      // The store caches state in the service worker. Reset it after clearing
      // storage so deleted graph/evidence cannot survive in memory or be
      // persisted again by a later mutation in the same worker lifetime.
      await personalAlgorithmStore.reset();
      await chrome.storage.local.set({
        [STORAGE_KEYS.MODE]: 'Default',
        [STORAGE_KEYS.FEED_REPLACEMENT_PERCENT]: 0,
        [STORAGE_KEYS.ENABLED]: false,
        [STORAGE_KEYS.HISTORY_EVIDENCE]: [],
        [STORAGE_KEYS.HOME_OBSERVATION_ENABLED]: false,
        [STORAGE_KEYS.HOME_OBSERVATIONS]: [],
        [STORAGE_KEYS.SELECTION_EVENTS]: [],
        [STORAGE_KEYS.RETRIEVAL_SETTINGS]: DEFAULT_RETRIEVAL_SETTINGS,
        [STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS]: EMPTY_RETRIEVAL_DIAGNOSTICS,
        [STORAGE_KEYS.SEMANTIC_MODEL_MODE]: 'hash',
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

  if (type === 'PERSONAL_ALGORITHM_EXPLAIN_CONTENT') {
    void (async () => {
      const externalId = typeof payload?.externalId === 'string' ? payload.externalId.trim() : '';
      if (!externalId) {
        sendResponse({ ok: false, error: 'A content ID is required.' });
        return;
      }

      const [candidateIndex, sourceFilters, mode] = await Promise.all([
        getCandidatePoolIndexCached(),
        getStorage<FeedSourceFilters>(STORAGE_KEYS.SOURCE_FILTERS, {}),
        getStorage<string>(STORAGE_KEYS.MODE, 'Default'),
      ]);
      const candidate = candidateIndex.get(externalId);
      if (!candidate) {
        sendResponse({
          ok: false,
          error: 'This content is no longer available in the local candidate reservoir.',
        });
        return;
      }

      const [hydrated] = await hydrateCandidatePool([candidate]);
      const [ranked] = await rankLocalCandidates([hydrated], sourceFilters, mode);
      if (!ranked) {
        sendResponse({ ok: false, error: 'Unable to score this content.' });
        return;
      }

      sendResponse({
        ok: true,
        item: {
          external_id: ranked.external_id,
          title: ranked.title,
          channel_name: ranked.channel_name ?? null,
          thumbnail_url: ranked.thumbnail_url ?? null,
          score: ranked.score,
          rawScore: ranked.rawScore,
          traceId: ranked.traceId,
          visible: ranked.visible,
          suppressed: ranked.suppressed,
          policyOutcome: ranked.policyOutcome,
          semantic_category: ranked.semantic_category ?? null,
          explanation: ranked.explanation ?? null,
        },
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to explain this content.',
    }));
    return true;
  }

  if (type === 'PERSONAL_ALGORITHM_INSPECT') {
    void personalAlgorithmStore.exportState()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to inspect Personal Algorithm Graph.',
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

  if (type === 'REFRESH_CONCEPT_EXTRACTION') {
    void (async () => {
      const semanticModelMode = await getSemanticModelMode();
      if (semanticModelMode !== 'neural') {
        sendResponse({
          ok: false,
          error: 'Local neural semantics must be enabled before concept extraction can run.',
        });
        return;
      }

      const generate = payload?.generate !== false;
      const materialization = await refreshSemanticConceptGraph(generate);
      const [conceptExtraction, conceptModelStatus] = await Promise.all([
        getStorage<Record<string, unknown> | null>(
          STORAGE_KEYS.CONCEPT_EXTRACTION_DIAGNOSTICS,
          null,
        ),
        getStorage<Record<string, unknown> | null>(
          STORAGE_KEYS.CONCEPT_MODEL_STATUS,
          null,
        ),
      ]);

      sendResponse({
        ok: true,
        generate,
        materialization: materialization.diagnostics,
        conceptExtraction,
        conceptModelStatus,
      });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to refresh concept extraction.',
    }));
    return true;
  }

  if (type === 'REFRESH_SEMANTICS') {
    void (async () => {
      const incomingCandidates = (payload as { candidates?: PageCandidate[] }).candidates ?? [];
      const mode = payload?.mode ?? 'default';
      if (incomingCandidates.length === 0) {
        sendResponse({ ok: true, changed: 0, diagnostics: null, skipped: 'no_candidates' });
        return;
      }

      const candidatePool = await mergeCandidatePool(incomingCandidates);
      const currentPageIds = new Set(
        incomingCandidates.map((candidate) => candidate.external_id).filter(Boolean),
      );
      const currentPagePool = candidatePool.filter((item) => currentPageIds.has(item.external_id));
      const hydrated = await hydrateCandidatePool(currentPagePool.slice(0, MAX_RANK_WORKING_SET));
      const semanticRefresh = await refreshSemanticScoreFeatures(hydrated, mode);
      sendResponse({
        ok: true,
        changed: semanticRefresh.changed,
        diagnostics: semanticRefresh.diagnostics,
      });
      const senderTabId = _sender.tab?.id;
      const pendingCandidateCount = Number(
        semanticRefresh.diagnostics?.pendingCandidateCount ?? 0,
      );
      if (senderTabId && semanticRefresh.changed > 0) {
        await chrome.tabs.sendMessage(senderTabId, {
          type: 'YOUTUBE_SEMANTICS_ENRICHED',
          payload: {
            count: semanticRefresh.changed,
            modelVersion: typeof semanticRefresh.diagnostics?.modelVersion === 'string'
              ? semanticRefresh.diagnostics.modelVersion
              : null,
            pendingCandidateCount,
          },
        }).catch(() => undefined);
      }

      if (
        semanticRefresh.diagnostics?.requestedSemanticModelMode === 'neural'
        && pendingCandidateCount === 0
      ) {
        void refreshSemanticConceptGraph(true).then(async (materialization) => {
          if (!materialization.changed || !senderTabId) return;
          await chrome.tabs.sendMessage(senderTabId, {
            type: 'YOUTUBE_SEMANTICS_ENRICHED',
            payload: {
              count: 0,
              conceptGraphChanged: true,
              graphRevision: materialization.diagnostics.graphRevision ?? null,
            },
          }).catch(() => undefined);
        }).catch((error) => {
          console.warn('[MyAlgo] deferred concept verification failed', error);
        });
      }
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to refresh semantic features.',
    }));
    return true;
  }

  if (type === 'RANK_PAGE') {
    void (async () => {
      const rankStartedAt = performance.now();
      try {
        const incomingCandidates = (payload as { candidates?: PageCandidate[] }).candidates ?? [];
        const cacheWarm = {
          candidatePool: candidatePoolMemory !== null,
          videoStore: videoStoreMemory !== null,
          semanticFeatures: semanticFeatureCacheMemory !== null,
        };
        const phaseTimings: Record<string, number> = {};
        let phaseStartedAt = performance.now();

        // First paint must never wait on network enrichment. Merge the live DOM
        // candidates immediately and hydrate only from metadata already cached
        // in local storage. Settings and pool hydration are independent, so keep
        // both storage operations concurrent on a cold service-worker start.
        const [sourceFilters, candidatePool, feedReplacementPercent] = await Promise.all([
          getStorage<FeedSourceFilters>(STORAGE_KEYS.SOURCE_FILTERS, {}),
          mergeCandidatePool(incomingCandidates, { deferPersistence: true }),
          getStorage<number>(STORAGE_KEYS.FEED_REPLACEMENT_PERCENT, 0),
        ]);
        phaseTimings.poolAndSettingsMs = Math.round(performance.now() - phaseStartedAt);
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
        phaseStartedAt = performance.now();
        const hydratedWorkingPool = await hydrateCandidatePool(workingPool);
        phaseTimings.metadataHydrationMs = Math.round(performance.now() - phaseStartedAt);
        phaseStartedAt = performance.now();
        const ranked = await rankLocalCandidates(hydratedWorkingPool, sourceFilters, payload?.mode ?? 'default');
        phaseTimings.scoringMs = Math.round(performance.now() - phaseStartedAt);
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
          .slice(0, MAX_RANK_WORKING_SET);
        const searchCandidatesScored = ranked.filter((item) => (
          !currentPageIds.has(item.external_id)
          && candidateHasAcquisitionMechanism(item, 'web_search')
        ));
        const searchCandidatesQualified = searchCandidatesScored.filter((item) => (
          item.visible !== false
          && item.suppressed !== true
          && item.policyOutcome === 'eligible'
          && item.score >= youtubeConnector.presentation.replacementMinimumScore
        ));
        const searchCandidatesInReplacementInventory = replacementInventory.filter((item) => (
          candidateHasAcquisitionMechanism(item, 'web_search')
        ));
        const presentationFeed = [
          ...currentPageFeed,
          ...replacementInventory,
        ];
        const scoreCalibration = summarizeLocalScoreCalibration(
          ranked,
          youtubeConnector.presentation.replacementMinimumScore,
          youtubeConnector.presentation.replacementMinimumUplift,
          feedReplacementPercent,
        );

        phaseStartedAt = performance.now();
        const [activeModeId, durableModeCatalog] = await Promise.all([
          getStorage<string>(STORAGE_KEYS.ACTIVE_MODE_ID, 'default'),
          getStorage<DurableSemanticModeCatalog | null>(
            STORAGE_KEYS.DURABLE_MODE_CATALOG,
            null,
          ),
        ]);
        const activeDurableMode = resolveDurableMode(durableModeCatalog, activeModeId);
        phaseTimings.responseContextMs = Math.round(performance.now() - phaseStartedAt);

        sendResponse({
          ok: true,
          activeDurableMode: activeDurableMode
            ? {
                id: activeDurableMode.id,
                label: activeDurableMode.label,
                revision: activeDurableMode.revision,
                memberLabels: activeDurableMode.members.map((member) => member.label),
              }
            : null,
          feed: presentationFeed,
          cachedFeedSize: feedCache.length,
          currentPageScored: currentPageFeed.length,
          replacementInventorySize: replacementInventory.length,
          searchCandidatesScored: searchCandidatesScored.length,
          searchCandidatesQualified: searchCandidatesQualified.length,
          searchCandidatesInReplacementInventory: searchCandidatesInReplacementInventory.length,
          maxSearchCandidateScore: searchCandidatesScored.length > 0
            ? Math.max(...searchCandidatesScored.map((item) => item.score))
            : null,
          poolSize: candidatePool.length,
          rankingWorkingSetSize: workingPool.length,
          enriched: 0,
          enrichmentPending: true,
          cacheWarm,
          phaseTimings,
          scoreCache: getLocalScoringDiagnostics(),
          scoreCalibration,
          elapsedMs: Math.round(performance.now() - rankStartedAt),
        });

        // Cache persistence is not presentation work. Persist only when the
        // presentation materially changes, and batch related keys into one
        // chrome.storage transaction to reduce serialization/IPC churn.
        const persistedPresentationFeed = presentationFeed.map((item) => ({
          external_id: item.external_id,
          title: item.title,
          channel_name: item.channel_name ?? null,
          thumbnail_url: item.thumbnail_url ?? null,
          source_kind: item.source_kind ?? null,
          is_short: item.is_short ?? false,
          is_live: item.is_live ?? false,
          rawScore: item.rawScore,
          score: item.score,
          visible: item.visible,
          suppressed: item.suppressed,
          policyOutcome: item.policyOutcome,
          traceId: item.traceId,
          content_label: item.content_label ?? null,
          content_label_confidence: item.content_label_confidence ?? null,
          semantic_category: item.semantic_category ?? null,
          semantic_category_confidence: item.semantic_category_confidence ?? null,
          semantic_category_scores: item.semantic_category_scores ?? {},
          semantic_mode_similarity: item.semantic_mode_similarity ?? null,
          semantic_model_version: item.semantic_model_version ?? null,
          provenance: item.provenance,
          acquisition_history: item.acquisition_history,
          explanation: item.explanation
            ? {
                rawScore: item.explanation.rawScore,
                displayScore: item.explanation.displayScore,
                graphRevision: item.explanation.graphRevision,
                acquisitionMechanism: item.explanation.acquisitionMechanism,
                contributions: [],
                matchedPaths: item.explanation.matchedPaths,
                modeGrounding: item.explanation.modeGrounding,
              }
            : undefined,
        }));
        const presentationCache = {
          mode: payload?.mode ?? 'default',
          activeModeId,
          activeModeRevision: activeDurableMode?.revision ?? null,
          generatedAt: new Date().toISOString(),
          feed: persistedPresentationFeed,
        };
        const rankCacheSignature = JSON.stringify({
          mode: presentationCache.mode,
          activeModeId,
          activeModeRevision: presentationCache.activeModeRevision,
          feed: persistedPresentationFeed.map((item) => [
            item.external_id,
            item.score,
            item.traceId,
            item.visible,
            item.suppressed,
            item.policyOutcome,
            item.title,
            item.channel_name,
            item.thumbnail_url,
            item.semantic_category,
            item.semantic_category_confidence,
            item.explanation?.modeGrounding?.modeId ?? null,
            item.explanation?.modeGrounding?.modeRevision ?? null,
            item.explanation?.modeGrounding?.total ?? null,
          ]),
        });
        if (
          rankCacheSignature !== lastPersistedRankCacheSignature
          || !rankSuccessStatePersisted
        ) {
          lastPersistedRankCacheSignature = rankCacheSignature;
          rankSuccessStatePersisted = true;
          void setStorageBatch({
            [STORAGE_KEYS.FEED_CACHE]: feedCache,
            [STORAGE_KEYS.PRESENTATION_CACHE]: presentationCache,
            [STORAGE_KEYS.LAST_SYNC]: new Date().toISOString(),
            'personal-algorithm-last-error': null,
          }).catch((error) => {
            console.warn('[MyAlgo] deferred rank cache persistence failed', error);
          });
        }

        await candidatePoolPersistQueue.catch((error) => {
          console.warn('[MyAlgo] deferred candidate-pool persistence failed', error);
        });

        const senderTabId = _sender.tab?.id ?? null;
        const activeRankMode = payload?.mode ?? 'default';
        scheduleRankSemanticRefresh(
          hydratedWorkingPool,
          activeRankMode,
          senderTabId,
        );

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
        rankSuccessStatePersisted = false;
        await setStorage('personal-algorithm-last-error', message);
        console.error('Failed to rank current YouTube page', message);
        sendResponse({ ok: false, error: message });
      }
    })();
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.SET_MODE) {
    void (async () => {
      const selection = await resolveModeSelection(payload?.modeId ?? payload?.mode ?? 'default');
      const previousDiagnostics = await getStorage<RetrievalDiagnostics>(
        STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS,
        EMPTY_RETRIEVAL_DIAGNOSTICS,
      );
      const nextDiagnostics = reconcileModeSupplyForSelection(
        previousDiagnostics,
        selection.modeId,
        selection.revision,
      );
      await Promise.all([
        setStorage(STORAGE_KEYS.ACTIVE_MODE_ID, selection.modeId),
        setStorage(STORAGE_KEYS.MODE, selection.label),
        setStorage(STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS, nextDiagnostics),
      ]);
      lastRankMemo = null;
      if (rankSemanticRefreshTimer) clearTimeout(rankSemanticRefreshTimer);
      rankSemanticRefreshTimer = null;
      rankSemanticRefreshPending = null;
      rankSemanticRefreshQueuedAt = 0;

      const [settings, tabs] = await Promise.all([
        getStorage<RetrievalSettings>(
          STORAGE_KEYS.RETRIEVAL_SETTINGS,
          DEFAULT_RETRIEVAL_SETTINGS,
        ),
        chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] }),
      ]);

      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, {
          type: 'MODE_CHANGED',
          payload: {
            mode: selection.label,
            modeId: selection.modeId,
            modeRevision: selection.revision,
            memberLabels: selection.memberLabels,
          },
        }).catch(() => undefined)
        : undefined));

      // Selection takes effect immediately; re-grounding and acquisition happen
      // automatically behind it rather than requiring a manual refresh.
      void refreshSelectedModeSemantics(selection, tabs).catch((error) => {
        console.warn('[MyAlgo] selected-mode semantic refresh failed', error);
      });
      if (settings.webSearchEnabled) {
        void refreshWebSearchCandidates(true, selection.label).then(async (refresh) => {
          if (refresh.changed) await notifyPersonalAlgorithmChanged('retrieval');
        }).catch((error) => console.warn('[MyAlgo] mode-driven web search refresh failed', error));
      }

      sendResponse({
        ok: true,
        mode: selection.label,
        modeId: selection.modeId,
        modeRevision: selection.revision,
      });
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
          !previousSettings.webSearchEnabled,
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
      getStorage<string>(STORAGE_KEYS.MODE, 'Default'),
      getStorage<string>(STORAGE_KEYS.ACTIVE_MODE_ID, 'default'),
      getStorage<DurableSemanticModeCatalog | null>(
        STORAGE_KEYS.DURABLE_MODE_CATALOG,
        null,
      ),
    ]).then(([state, mode, activeModeId, durableModeCatalog]) => {
      const activeDurableMode = resolveDurableMode(durableModeCatalog, activeModeId);
      const baseProfile = buildGraphRetrievalProfile(state);
      const profile = activeDurableMode
        ? applyDurableModeToRetrievalProfile(baseProfile, activeDurableMode)
        : applyModeToRetrievalProfile(baseProfile, mode);
      const retrievalRevision = buildGraphRetrievalRevision(state);
      const modeRevisionTag = activeDurableMode
        ? `${activeDurableMode.id}:r${activeDurableMode.revision}`
        : mode.toLowerCase();
      const plans = buildRecommendationQueryPlans(
        profile,
        activeDurableMode ? 16 : 8,
        `${retrievalRevision}:mode-${modeRevisionTag}`,
        [],
        [],
        true,
      );
      const priorityModeTopics = activeDurableMode
        ? [...activeDurableMode.members]
            .sort((left, right) => (
              right.weight - left.weight
              || left.canonicalId.localeCompare(right.canonicalId)
            ))
            .map((member) => member.label)
        : [];
      const acquisitionPlans = selectWebSearchPlans(
        plans,
        4,
        priorityModeTopics,
      );
      sendResponse({
        ok: true,
        mode,
        activeMode: activeDurableMode
          ? {
              id: activeDurableMode.id,
              label: activeDurableMode.label,
              revision: activeDurableMode.revision,
              members: activeDurableMode.members.map((member) => ({
                canonicalId: member.canonicalId,
                label: member.label,
                weight: member.weight,
              })),
            }
          : null,
        graphRevision: state.graph.currentRevision,
        retrievalRevision,
        goal: profile.goal,
        explicitTopics: profile.explicitTopics,
        topicCount: profile.explicitTopics.length,
        creatorCount: profile.creatorTerms.length,
        plans,
        acquisitionPlans,
      });
    }).catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to build retrieval plan.',
    }));
    return true;
  }

  if (type === 'GET_SEMANTIC_DIAGNOSTICS') {
    void Promise.all([
      getStorage<Record<string, unknown> | null>(STORAGE_KEYS.SEMANTIC_DIAGNOSTICS, null),
      getStorage<Record<string, unknown> | null>(STORAGE_KEYS.SEMANTIC_CONCEPT_DIAGNOSTICS, null),
      getStorage<Record<string, unknown> | null>(STORAGE_KEYS.CONCEPT_EXTRACTION_DIAGNOSTICS, null),
      getStorage<Record<string, unknown> | null>(STORAGE_KEYS.CONCEPT_MODEL_STATUS, null),
      getStorage<DurableSemanticModeCatalog | null>(STORAGE_KEYS.DURABLE_MODE_CATALOG, null),
      getStorage<Record<string, unknown> | null>(STORAGE_KEYS.DURABLE_MODE_DIAGNOSTICS, null),
    ]).then(([diagnostics, conceptMaterialization, conceptExtraction, conceptModelStatus, durableModes, durableModeDiagnostics]) => {
      sendResponse({
        ok: true,
        diagnostics,
        conceptMaterialization,
        conceptExtraction,
        conceptModelStatus,
        durableModes,
        durableModeDiagnostics,
      });
    }).catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to read semantic diagnostics.',
    }));
    return true;
  }

  if (type === 'MODE_SUPPLY_DIAGNOSTICS') {
    void (async () => {
      const previous = await getStorage<RetrievalDiagnostics>(
        STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS,
        EMPTY_RETRIEVAL_DIAGNOSTICS,
      );
      const nextModeSupply = payload?.modeSupply ?? null;
      const requestedDiagnostics: RetrievalDiagnostics = {
        ...previous,
        modeSupply: nextModeSupply,
      };
      const reconciled = await reconcileRetrievalDiagnosticsForActiveMode(
        requestedDiagnostics,
      );
      const same = JSON.stringify(previous.modeSupply ?? null)
        === JSON.stringify(reconciled.modeSupply ?? null);
      if (!same) {
        await setStorage(STORAGE_KEYS.RETRIEVAL_DIAGNOSTICS, reconciled);
      }
      sendResponse({ ok: true, modeSupply: reconciled.modeSupply ?? null });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to persist mode supply diagnostics.',
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

  if (type === 'SET_FEED_REPLACEMENT_PERCENT') {
    void (async () => {
      const raw = Number(payload?.feedReplacementPercent);
      const percent = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
      await setStorage(STORAGE_KEYS.FEED_REPLACEMENT_PERCENT, percent);
      const tabs = await chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, {
          type: 'FEED_REPLACEMENT_CHANGED',
          payload: { percent },
        }).catch(() => undefined)
        : undefined));
      sendResponse({ ok: true, percent });
    })().catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to change feed replacement.',
    }));
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
      if (events.length >= MAX_SELECTION_EVENTS) {
        await personalAlgorithmStore.compactEvidence(MAX_DEFAULT_ALGORITHM_EVIDENCE);
      }
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
      if (events.length >= MAX_SELECTION_EVENTS) {
        await personalAlgorithmStore.compactEvidence(MAX_DEFAULT_ALGORITHM_EVIDENCE);
      }
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
      const validHistoryEvidence = historyEvidence
        .filter((item) => (
          item?.externalId && item.title && item.provenance === 'youtube_history_dom'
        ))
        .slice(0, MAX_HISTORY_ITEMS_PER_OBSERVATION);
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
      await personalAlgorithmStore.compactEvidence(MAX_DEFAULT_ALGORITHM_EVIDENCE);
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
      const observations = mergeRecommendationObservations(
        existing,
        validIncoming,
        MAX_HOME_OBSERVATIONS,
      );
      console.info('[MyAlgo] recommendation observation prepared', {
        incoming: incoming.length,
        validIncoming: validIncoming.length,
        existing: existing.length,
        merged: observations.length,
      });
      await setStorage(STORAGE_KEYS.HOME_OBSERVATIONS, observations);
      await setStorage(STORAGE_KEYS.HOME_METRICS, payload?.metrics as RecommendationObservationMetrics);
      await personalAlgorithmStore.reconcileExposureEvidence(
        observations.map((observation) => ({
          id: `exposure:${observation.exposureId}`,
          evidence: toNormalizedExposure(observation),
          confidence: 1,
        })),
        'home_dom',
      );
      await personalAlgorithmStore.compactEvidence(MAX_DEFAULT_ALGORITHM_EVIDENCE);
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message as { target?: string } | null)?.target?.endsWith('-offscreen')) {
    return false;
  }
  return handleRuntimeMessage(message, sender, sendResponse);
});

chrome.runtime.onMessageExternal.addListener((_message, _sender, sendResponse) => {
  sendResponse({ ok: true });
  return true;
});

const message = createMessage(EXTENSION_MESSAGE_TYPES.GET_FEED, { algorithmId: 'demo' });
console.info('Background service worker ready', message);
