import { createMessage, EXTENSION_MESSAGE_TYPES } from '../lib/messaging';
import { STORAGE_KEYS, getStorage, setStorage } from '../lib/storage';
import type { FeedSourceFilters } from '@repo/shared-types';
import { youtubeConnector } from '../connectors/youtube';
import type { HistoryEvidence, HistoryObservationMetrics } from '../content-scripts/youtube-history';
import { applyRecommendationOutcome, mergeRecommendationObservations, type RecommendationObservation, type RecommendationObservationMetrics } from '../content-scripts/youtube-recommendations';

type PageCandidate = {
  external_id: string;
  title: string;
  channel_name?: string | null;
  is_short?: boolean;
  is_live?: boolean;
};

type CandidatePoolItem = PageCandidate & {
  firstSeenAt: string;
  lastSeenAt: string;
};

type LocalFeedItem = CandidatePoolItem & {
  id: string;
  score: number;
  visible: boolean;
  source_kind: null;
};

const MAX_CANDIDATE_POOL_SIZE = 5000;
const MAX_HISTORY_EVIDENCE = 10000;

async function mergeCandidatePool(candidates: PageCandidate[]): Promise<CandidatePoolItem[]> {
  const existing = await getStorage<CandidatePoolItem[]>(
    STORAGE_KEYS.FEED_CANDIDATE_POOL,
    [],
  );

  const now = new Date().toISOString();
  const byId = new Map<string, CandidatePoolItem>(
    existing.map((candidate) => [candidate.external_id, candidate]),
  );

  for (const candidate of candidates) {
    if (!candidate.external_id || !candidate.title) continue;

    const previous = byId.get(candidate.external_id);
    byId.set(candidate.external_id, {
      ...previous,
      ...candidate,
      external_id: candidate.external_id,
      title: candidate.title,
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: now,
    });
  }

  const pool = [...byId.values()]
    .sort(
      (a, b) =>
        new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
    )
    .slice(0, MAX_CANDIDATE_POOL_SIZE);

  await setStorage(STORAGE_KEYS.FEED_CANDIDATE_POOL, pool);
  return pool;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    [STORAGE_KEYS.MODE]: 'Work',
    [STORAGE_KEYS.ENABLED]: true,
    [STORAGE_KEYS.FEED_CACHE]: [],
    [STORAGE_KEYS.FEED_CANDIDATE_POOL]: [],
    [STORAGE_KEYS.LAST_SYNC]: null,
    [STORAGE_KEYS.SOURCE_FILTERS]: {
      subscribedOnly: false,
      includeDiscovery: true,
      includeShorts: true,
      includeLive: true,
    },
    [STORAGE_KEYS.HISTORY_OBSERVATION_ENABLED]: false,
    [STORAGE_KEYS.HISTORY_EVIDENCE]: [],
    [STORAGE_KEYS.HISTORY_METRICS]: null,
    [STORAGE_KEYS.HOME_OBSERVATION_ENABLED]: false,
    [STORAGE_KEYS.HOME_OBSERVATIONS]: [],
    [STORAGE_KEYS.HOME_METRICS]: null,
  });
});

function rankLocalCandidates(candidates: CandidatePoolItem[], sourceFilters: FeedSourceFilters): LocalFeedItem[] {
  return candidates.map((candidate, index) => ({
    ...candidate,
    id: candidate.external_id,
    score: Math.max(52, 100 - index),
    visible: !(
      (candidate.is_short && sourceFilters.includeShorts === false)
      || (candidate.is_live && sourceFilters.includeLive === false)
    ),
    source_kind: null,
  }));
}

async function recordLocalEvent(kind: 'activity' | 'feedback', payload: unknown): Promise<void> {
  const events = await getStorage<Array<{ kind: string; payload: unknown; recordedAt: string }>>('personal-algorithm-local-events', []);
  await setStorage('personal-algorithm-local-events', [
    ...events.slice(-199),
    { kind, payload, recordedAt: new Date().toISOString() },
  ]);
}

async function correlateRecommendationOutcome(externalId: string, outcome: 'clicked' | 'watched'): Promise<void> {
  const observations = await getStorage<RecommendationObservation[]>(STORAGE_KEYS.HOME_OBSERVATIONS, []);
  await setStorage(
    STORAGE_KEYS.HOME_OBSERVATIONS,
    applyRecommendationOutcome(observations, externalId, outcome),
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
      evidence?: unknown[];
      observations?: unknown[];
      metrics?: unknown;
    };
  };

  if (type === EXTENSION_MESSAGE_TYPES.GET_FEED) {
    void getStorage(STORAGE_KEYS.FEED_CACHE, []).then((feed) => {
      sendResponse({ feed });
    });
    return true;
  }

  if (type === 'RANK_PAGE') {
    void (async () => {
      try {
        const sourceFilters = await getStorage<FeedSourceFilters>(STORAGE_KEYS.SOURCE_FILTERS, {});
        const incomingCandidates = (payload as { candidates?: PageCandidate[] }).candidates ?? [];
        const candidatePool = await mergeCandidatePool(incomingCandidates);
        const ranked = rankLocalCandidates(candidatePool, sourceFilters);
        await setStorage(STORAGE_KEYS.FEED_CACHE, ranked);
        await setStorage(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
        await setStorage('personal-algorithm-last-error', null);
        sendResponse({ ok: true, feed: ranked, poolSize: candidatePool.length });
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

  if (type === 'SET_SOURCE_FILTERS') {
    void (async () => {
      await setStorage(STORAGE_KEYS.SOURCE_FILTERS, payload?.sourceFilters ?? {});
      const tabs = await chrome.tabs.query({ url: [...youtubeConnector.pageUrlPatterns] });
      await Promise.all(tabs.map((tab) => tab.id
        ? chrome.tabs.sendMessage(tab.id, { type: 'SOURCE_FILTERS_CHANGED' }).catch(() => undefined)
        : undefined));
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.FEEDBACK) {
    void recordLocalEvent('feedback', payload);
    void setStorage(STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
    sendResponse({ ok: true, contentItemId: payload?.contentItemId, eventType: payload?.eventType });
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.ACTIVITY) {
    void recordLocalEvent('activity', payload);
    if (payload?.externalId) void correlateRecommendationOutcome(payload.externalId, 'clicked');
    sendResponse({ ok: true, externalId: payload?.externalId, eventType: payload?.eventType });
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.HISTORY_OBSERVATION) {
    void (async () => {
      const historyEvidence = Array.isArray(payload?.evidence) ? payload.evidence as HistoryEvidence[] : [];
      const existing = await getStorage<HistoryEvidence[]>(STORAGE_KEYS.HISTORY_EVIDENCE, []);
      const byExternalId = new Map(existing.map((item) => [item.externalId, item]));
      for (const item of historyEvidence) {
        if (item?.externalId && item.title && item.provenance === 'youtube_history_dom') {
          byExternalId.set(item.externalId, item);
        }
      }
      const evidence = [...byExternalId.values()]
        .sort(
          (a, b) =>
            new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
        )
        .slice(0, MAX_HISTORY_EVIDENCE);
      await setStorage(STORAGE_KEYS.HISTORY_EVIDENCE, evidence);
      await setStorage(STORAGE_KEYS.HISTORY_METRICS, payload?.metrics as HistoryObservationMetrics);
      await Promise.all(historyEvidence.map((item) => correlateRecommendationOutcome(item.externalId, 'watched')));
      sendResponse({ ok: true, storedEvidence: evidence.length });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to store history observation.' }));
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.RECOMMENDATION_OBSERVATION) {
    void (async () => {
      const incoming = Array.isArray(payload?.observations) ? payload.observations as RecommendationObservation[] : [];
      const existing = await getStorage<RecommendationObservation[]>(STORAGE_KEYS.HOME_OBSERVATIONS, []);
      const validIncoming = incoming.filter((observation) => (
        observation?.externalId && observation.title && observation.evidenceKind === 'surfaced'
      ));
      const observations = mergeRecommendationObservations(existing, validIncoming);
      await setStorage(STORAGE_KEYS.HOME_OBSERVATIONS, observations);
      await setStorage(STORAGE_KEYS.HOME_METRICS, payload?.metrics as RecommendationObservationMetrics);
      sendResponse({ ok: true, storedObservations: observations.length });
    })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Unable to store recommendation observation.' }));
    return true;
  }

  if (type === EXTENSION_MESSAGE_TYPES.OPEN_OPTIONS) {
    void chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  sendResponse({ ok: false });
  return true;
});

chrome.runtime.onMessageExternal.addListener((_message, _sender, sendResponse) => {
  sendResponse({ ok: true });
  return true;
});

const message = createMessage(EXTENSION_MESSAGE_TYPES.GET_FEED, { algorithmId: 'demo' });
console.info('Background service worker ready', message);
