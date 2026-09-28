import { STORAGE_KEYS } from '../lib/storage';
import { EXTENSION_MESSAGE_TYPES } from '../lib/messaging';
import { MYALGO_INJECTED_SELECTOR, buildModeSupplyPlan, createReplacementSelectionSeed, createReplacementSlotId, dedupeCandidatesById, getContentPresentationLabel, getNativeCardDecision, getReplacementCandidates, getReplacementPresentationMetadata, getReplacementTextMetadata, getSourceShelfHideReason, isDurableModeGroundedItem, isMyAlgoInjectedElement, isRenderContextStale, isReplacementEligibleNativeDecision, keepOutermostElements, planReplacementAssignments, replacementQuota, selectFeedMixAssignments, shouldHideForSourceFilters } from './youtube-ux';
import type { DurableModePresentationContext, ModeSupplyPlan, RankedFeedItem } from './youtube-ux';
import { youtubeConnector } from '../connectors/youtube';

import type { DurableSemanticModeCatalog, FeedSourceFilters, ModeSupplyDiagnostics } from '@repo/shared-types';
import { isPrivacyDisclosureAccepted } from '../lib/privacy';
import { collectHistoryEvidenceFromDom, isYouTubeHistoryPage } from './youtube-history';
import { collectRecommendationObservationsFromDom, isYouTubeHomePage } from './youtube-recommendations';
import { createSelectionObservation, getSelectionFromTarget, getYouTubeSurface } from './youtube-interactions';
import {
  advanceWatchSession,
  createTemporalWatchObservation,
  createWatchSession,
  markWatchEmitted,
  resetWatchSeek,
  type WatchSessionState,
} from './youtube-watch';

const videoSelectors = youtubeConnector.cardSelectors;
const videoLinkSelector = youtubeConnector.videoLinkSelector;

let cachedFeed: RankedFeedItem[] = [];
let rankingInFlight = false;
let activeMode = 'Default';
let rankGeneration = 0;
let rankTimer: number | undefined;
let mutationRankTimer: number | undefined;
let rankQueued = false;
let statusDismissTimer: number | undefined;
let resizeTimer: number | undefined;
let historyObservationTimer: number | undefined;
let recommendationObservationTimer: number | undefined;
let extensionEnabled = false;
let lastCandidateSignature = '';
let lastRankMode = '';
let sourceFilters: FeedSourceFilters = {};
let feedReplacementPercent = 0;
let activeDurableMode: DurableModePresentationContext | null = null;
let latestModeSupplyPlan: ModeSupplyPlan | null = null;
let lastModeSupplySignature = '';
let lastSelectionInteraction: { signature: string; kind: 'click' | 'auxclick' | 'keyboard'; at: number } | null = null;
const WATCH_SELECTION_INTENT_MAX_AGE_MS = 15_000;
let pendingWatchExposure: { videoId: string; exposureId: string | null; observedAt: number } | null = null;
let watchedVideo: HTMLVideoElement | null = null;
let watchSession: WatchSessionState | null = null;
let watchSessionSequence = 0;
const stableReplacementBySourceId = new Map<string, {
  candidateId: string;
  item: RankedFeedItem;
  routeKey: string;
}>();

const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const instanceAttribute = 'data-personal-algorithm-instance';
document.documentElement.setAttribute(instanceAttribute, instanceId);

const isCurrentInstance = () => document.documentElement.getAttribute(instanceAttribute) === instanceId;
const getRouteKey = () => `${location.pathname}${location.search}`;
const clearStableReplacements = () => stableReplacementBySourceId.clear();

const logStaleRender = (phase: string, requestGeneration: number) => {
  console.info('[MyAlgo] skipped stale render', {
    phase,
    requestGeneration,
    latestGeneration: rankGeneration,
  });
};

const isExtensionContextValid = () => {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
};

const safeSendMessage = (
  message: unknown,
  callback?: (response: any) => void,
) => {
  if (!isExtensionContextValid()) return false;
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) return;
      callback?.(response);
    });
    return true;
  } catch {
    return false;
  }
};

const safeStorageGet = (keys: string[]): Promise<Record<string, unknown>> => {
  if (!isExtensionContextValid()) return Promise.resolve({});
  try {
    return chrome.storage.local
      .get(keys)
      .then((result) => result as Record<string, unknown>)
      .catch(() => ({}));
  } catch {
    return Promise.resolve({});
  }
};

const showStatus = (message: string, error = false, paused = false) => {
  if (!isCurrentInstance()) return;
  let status = document.querySelector<HTMLElement>('[data-personal-algorithm-status]');
  if (!status) {
    status = document.createElement('div');
    status.dataset.personalAlgorithmStatus = 'true';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:72px;pointer-events:none;max-width:min(320px,calc(100vw - 24px));padding:10px 14px;border-radius:14px;border:1px solid rgba(148,163,184,0.35);font:700 12px/1.3 sans-serif;letter-spacing:0.02em;box-shadow:0 10px 26px rgba(15,23,42,0.38);';
    document.body.appendChild(status);
  }

  const isError = error || (!paused && message.toLowerCase().includes('failed'));
  status.style.background = isError ? '#7f1d1d' : paused ? '#374151' : '#14532d';
  status.style.color = '#f8fafc';
  status.style.borderColor = isError ? 'rgba(248,113,113,0.7)' : paused ? 'rgba(148,163,184,0.7)' : 'rgba(52,211,153,0.7)';
  status.textContent = message;
  if (statusDismissTimer !== undefined) window.clearTimeout(statusDismissTimer);
  const dismissAfter = isError ? 8000 : 3500;
  statusDismissTimer = window.setTimeout(() => {
    if (status?.isConnected && status.textContent === message) status.remove();
    statusDismissTimer = undefined;
  }, dismissAfter);
};

const normalizeText = (value: string) => youtubeConnector.normalizeText(value).toLowerCase();

const clearExtensionPresentation = (
  showPaused = true,
  preserveReplacements = false,
) => {
  document.querySelector('[data-personal-algorithm-shelf]')?.remove();
  document.querySelectorAll<HTMLElement>(
    '[data-personal-algorithm-replacement], [data-personal-algorithm-explanation], [data-personal-algorithm-control]',
  ).forEach((element) => {
    if (
      preserveReplacements
      && (
        element.matches('[data-personal-algorithm-replacement]')
        || element.closest('[data-personal-algorithm-replacement]')
      )
    ) return;
    element.remove();
  });
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-badge]').forEach((badge) => badge.remove());
  document.querySelectorAll<HTMLElement>(
    '[data-personal-algorithm-source-shelf-hidden], [data-personal-algorithm-source-row-hidden], [data-personal-algorithm-source-section-hidden], [data-personal-algorithm-source-layout-hidden]',
  ).forEach((container) => {
    container.style.removeProperty('display');
    delete container.dataset.personalAlgorithmSourceShelfHidden;
    delete container.dataset.personalAlgorithmSourceRowHidden;
    delete container.dataset.personalAlgorithmSourceSectionHidden;
    delete container.dataset.personalAlgorithmSourceLayoutHidden;
  });
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-position-patched="true"]').forEach((element) => {
    element.style.removeProperty('position');
    delete element.dataset.personalAlgorithmPositionPatched;
  });
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-score]').forEach((element) => {
    element.style.removeProperty('display');
    element.style.outline = '';
    element.style.outlineOffset = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;
    delete element.dataset.personalAlgorithmSlotId;
    delete element.dataset.personalAlgorithmSlotWidth;
    delete element.dataset.personalAlgorithmReplacementCandidateId;
  });
  if (showPaused) {
    showStatus('Personal Algorithm: Paused', false, true);
  } else {
    document.querySelector('[data-personal-algorithm-status]')?.remove();
  }
};

const createThumbnail = (
  item: RankedFeedItem,
  aspectRatio = youtubeConnector.presentation.horizontalAspectRatio,
): HTMLElement => {
  const media = item.thumbnail_url ? document.createElement('img') : document.createElement('div');
  if (media instanceof HTMLImageElement) {
    media.src = item.thumbnail_url ?? '';
    media.alt = '';
    media.loading = 'lazy';
  } else {
    media.setAttribute('aria-hidden', 'true');
    media.textContent = 'Thumbnail unavailable';
    media.style.cssText = `display:flex;width:100%;aspect-ratio:${aspectRatio};align-items:center;justify-content:center;border-radius:10px;background:var(--yt-spec-10-percent-layer, #272727);color:var(--yt-spec-text-secondary, #aaa);font:500 12px/1.3 Roboto,Arial,sans-serif;`;
    return media;
  }
  media.style.cssText = `display:block;width:100%;aspect-ratio:${aspectRatio};object-fit:cover;border-radius:10px;background:var(--yt-spec-10-percent-layer, #272727);`;
  return media;
};

const createReplacementCard = (
  item: RankedFeedItem,
  target: HTMLElement,
  slotId: string,
  sourceVideoId: string,
  generation: number,
): HTMLElement => {
  const card = document.createElement('article');
  const targetWidth = Number(target.dataset.personalAlgorithmSlotWidth ?? 0);
  const targetFlags = getVideoSourceFlags(target);
  const aspectRatio = targetFlags.is_short
    ? youtubeConnector.presentation.verticalAspectRatio
    : youtubeConnector.presentation.horizontalAspectRatio;

  const metadata = getReplacementPresentationMetadata(
    { slot: { slotId, sourceVideoId }, item },
    generation,
    activeMode,
  );
  const displayMetadata = getReplacementTextMetadata(item);
  card.dataset.personalAlgorithmReplacement = 'true';
  card.dataset.personalAlgorithmVideoId = metadata.replacementVideoId;
  card.dataset.personalAlgorithmTraceId = metadata.traceId;
  card.dataset.personalAlgorithmReplacementSlot = metadata.slotId;
  card.dataset.personalAlgorithmReplacementSourceVideoId = metadata.sourceVideoId;
  card.dataset.personalAlgorithmReplacementGeneration = String(metadata.generation);
  card.dataset.personalAlgorithmReplacementMode = metadata.mode;
  card.dataset.personalAlgorithmReplacementScore = String(metadata.score);
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `MyAlgo replacement: ${item.title ?? 'Recommended video'}`);
  card.style.cssText = `display:block;width:100%;max-width:${targetWidth > 0 ? `${targetWidth}px` : '100%'};min-width:0;align-self:start;box-sizing:border-box;position:relative;color:var(--yt-spec-text-primary, #0f0f0f);font-family:Roboto,Arial,sans-serif;`;

  const replacementBadge = document.createElement('span');
  replacementBadge.dataset.personalAlgorithmBadge = 'true';
  const contentLabel = getContentPresentationLabel(item);
  replacementBadge.textContent = contentLabel
    ? `${contentLabel} · MyAlgo replacement · ${metadata.score}`
    : `MyAlgo replacement · ${metadata.score}`;
  replacementBadge.style.cssText = 'position:absolute;z-index:30;top:8px;left:8px;max-width:calc(100% - 16px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 8px;border-radius:999px;background:#0f172a;color:#fff;font:700 11px/1.2 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;';
  card.appendChild(replacementBadge);

  const link = document.createElement('a');
  link.href = youtubeConnector.getCanonicalUrl(item.external_id ?? '');
  link.dataset.personalAlgorithmVideoId = item.external_id ?? '';
  link.setAttribute('aria-label', item.title ?? 'MyAlgo recommended video');
  link.style.cssText = 'display:block;color:inherit;text-decoration:none;min-width:0;';
  link.appendChild(createThumbnail(item, aspectRatio));

  const videoMeta = document.createElement('div');
  videoMeta.dataset.personalAlgorithmVideoMetadata = 'true';
  videoMeta.style.cssText = 'display:block;margin-top:10px;min-width:0;padding:0 2px;';

  const title = document.createElement('div');
  title.dataset.personalAlgorithmTitle = 'true';
  title.textContent = displayMetadata.title;
  title.style.cssText = 'display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--yt-spec-text-primary,#f1f1f1);font-size:16px;font-weight:600;line-height:22px;white-space:normal;';
  videoMeta.appendChild(title);

  const channel = document.createElement('div');
  channel.dataset.personalAlgorithmCreator = 'true';
  channel.textContent = displayMetadata.creator;
  channel.style.cssText = 'display:block;margin-top:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--yt-spec-text-secondary,#aaa);font-size:14px;line-height:20px;';
  videoMeta.appendChild(channel);
  link.appendChild(videoMeta);
  card.appendChild(link);

  const meta = document.createElement('div');
  meta.textContent = contentLabel
    ? `${contentLabel} · MyAlgo · ${item.score ?? 0}/100`
    : `MyAlgo · ${item.score ?? 0}/100`;
  meta.style.cssText = 'margin-top:7px;color:var(--yt-spec-text-secondary,#aaa);font-size:12px;line-height:17px;font-weight:600;';
  card.appendChild(meta);

  const why = document.createElement('button');
  why.type = 'button';
  why.dataset.personalAlgorithmExplanation = 'true';
  why.dataset.personalAlgorithmTraceId = item.traceId ?? '';
  why.textContent = 'Why this?';
  why.setAttribute('aria-label', 'Why MyAlgo showed this replacement');
  why.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;margin-top:7px;padding:6px 10px;border-radius:999px;border:1px solid #475569;background:#0f172a;color:#fff;font:700 11px/1.2 sans-serif;cursor:pointer;appearance:none;-webkit-appearance:none;';
  const explanation = document.createElement('div');
  explanation.dataset.personalAlgorithmExplanationPanel = 'true';
  explanation.hidden = true;
  explanation.style.cssText = 'margin-top:8px;padding:9px 10px;border:1px solid rgba(148,163,184,.35);border-radius:10px;background:rgba(15,23,42,.88);color:#f8fafc;font:500 12px/1.45 Roboto,Arial,sans-serif;white-space:normal;';

  const explanationData = item.explanation;
  const scoreLine = document.createElement('div');
  scoreLine.textContent = explanationData
    ? `Score ${explanationData.displayScore}/100 · raw ${explanationData.rawScore} · graph r${explanationData.graphRevision}`
    : `Score ${item.score ?? 0}/100 · trace ${item.traceId ?? 'unavailable'}`;
  explanation.appendChild(scoreLine);

  if (explanationData?.acquisitionMechanism) {
    const acquired = document.createElement('div');
    acquired.textContent = `Acquired via ${explanationData.acquisitionMechanism} · acquisition is not preference evidence`;
    acquired.style.cssText = 'margin-top:4px;color:#cbd5e1;';
    explanation.appendChild(acquired);
  }

  for (const contribution of explanationData?.contributions ?? []) {
    const row = document.createElement('div');
    const sign = contribution.value > 0 ? '+' : '';
    row.textContent = `${contribution.label}: ${sign}${contribution.value}`;
    row.style.cssText = 'margin-top:4px;';
    explanation.appendChild(row);
  }

  why.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    explanation.hidden = !explanation.hidden;
    why.setAttribute('aria-expanded', String(!explanation.hidden));
  });
  why.setAttribute('aria-expanded', 'false');
  card.appendChild(why);
  card.appendChild(explanation);

  return card;
};

const clearLegacyRecommendationShelf = () => {
  document.querySelector('[data-personal-algorithm-shelf]')?.remove();
};

const getVideoTitle = (element: HTMLElement) => {
  const titleNode = element.querySelector<HTMLElement>(youtubeConnector.titleSelectors.join(','));

  const directTitle =
    titleNode?.getAttribute('title')
    ?? titleNode?.getAttribute('aria-label')
    ?? titleNode?.textContent
    ?? '';

  if (normalizeText(directTitle)) {
    return normalizeText(directTitle);
  }

  const linkedTitle = Array.from(element.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .map((link) => youtubeConnector.getLinkTitle({
      title: link.getAttribute('title'),
      ariaLabel: link.getAttribute('aria-label'),
      textContent: link.textContent,
    }))
    .map((value) => normalizeText(value))
    .find(Boolean);

  if (linkedTitle) {
    return linkedTitle;
  }

  const fallback = normalizeText(element.textContent ?? '').slice(0, 140);
  return fallback;
};

const getVideoId = (element: HTMLElement) => {
  const links = Array.from(element.querySelectorAll<HTMLAnchorElement>(`a#thumbnail[href], a#video-title-link[href], ${videoLinkSelector}`));
  const videoId = links
    .map((link) => youtubeConnector.getExternalId(link.href))
    .find(Boolean);
  return videoId ?? `title:${getVideoTitle(element)}`;
};

const getVideoSourceFlags = (element: HTMLElement) => {
  const href = Array.from(element.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))[0]?.href ?? '';
  return youtubeConnector.getSourceFlags(href);
};

const sendActivity = (externalId: string, eventType: 'opened' | 'revisited') => {
  if (!extensionEnabled || !externalId || externalId.startsWith('title:')) return;
  safeSendMessage({
    type: 'ACTIVITY',
    payload: { externalId, eventType: youtubeConnector.mapPresentationEvent(eventType) },
  });
};

const getCardForVideoLink = (link: HTMLAnchorElement) => {
  if (isMyAlgoInjectedElement(link)) return null;
  const knownCard = link.closest(videoSelectors.join(',')) as HTMLElement | null;
  if (knownCard) return knownCard;

  let current: HTMLElement | null = link.parentElement;
  for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
    const hasVideoLink = current.querySelector(videoLinkSelector);
    const hasTitleNode = current.querySelector('#video-title, #video-title-link, yt-formatted-string#video-title, a[title], a[aria-label]');
    const text = normalizeText(current.textContent ?? '');
    if (hasVideoLink && hasTitleNode && text.length > 12 && text.length < 1200) {
      return current;
    }
  }

  return link.parentElement;
};

const getChannelName = (element: HTMLElement) => normalizeText(
  element.querySelector('#channel-name, ytd-channel-name, .ytd-channel-name')?.textContent ?? '',
);

const getVideoElements = (diagnoseInjected = false) => {
  const knownElements = Array.from(document.querySelectorAll(videoSelectors.join(','))) as HTMLElement[];
  const linkElements = Array.from(document.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .map(getCardForVideoLink)
    .filter((element): element is HTMLElement => Boolean(element));
  const uniqueElements = Array.from(new Set([...knownElements, ...linkElements]));
  const nativeElements = keepOutermostElements(
    uniqueElements.filter((element) => !isMyAlgoInjectedElement(element)),
    (parent, child) => parent.contains(child),
  );
  const skippedInjected = uniqueElements.length - uniqueElements.filter(
    (element) => !isMyAlgoInjectedElement(element),
  ).length;
  if (diagnoseInjected && skippedInjected > 0) {
    console.info('[MyAlgo] skipped injected candidate elements', { count: skippedInjected });
  }
  return nativeElements;
};

const getPageSourceKind = (): 'subscription' | 'discovery' | 'liked' | null => {
  const path = location.pathname.toLowerCase();
  if (path === '/feed/subscriptions') return 'subscription';
  if (path === '/playlist' && new URLSearchParams(location.search).get('list') === 'LL') return 'liked';
  if (path === '/' || path === '/results' || path === '/watch' || path.startsWith('/shorts')) return 'discovery';
  return null;
};

const collectCandidates = () => {
  const sourceKind = getPageSourceKind();
  const cardCandidates = getVideoElements(true)
    .map((element) => ({
      external_id: getVideoId(element),
      title: getVideoTitle(element),
      channel_name: getChannelName(element),
      thumbnail_url: element.querySelector<HTMLImageElement>('img[src]')?.src ?? null,
      source_kind: sourceKind,
      ...getVideoSourceFlags(element),
    }))
    .filter((candidate) => candidate.title)
    .slice(0, youtubeConnector.presentation.candidateLimit);

  const anchorCandidates = Array.from(document.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .filter((link) => !isMyAlgoInjectedElement(link))
    .map((link) => ({
      external_id: youtubeConnector.getExternalId(link.href) ?? '',
      title: normalizeText(youtubeConnector.getLinkTitle({
        title: link.getAttribute('title'),
        ariaLabel: link.getAttribute('aria-label'),
        textContent: link.textContent,
      })),
      channel_name: '',
      source_kind: sourceKind,
      ...youtubeConnector.getSourceFlags(link.href),
    }))
    .filter((candidate) => candidate.external_id && candidate.title);

  const candidates = dedupeCandidatesById([...cardCandidates, ...anchorCandidates])
    .slice(0, youtubeConnector.presentation.candidateLimit);

  if (candidates.length === 0) {
    console.info('Personal Algorithm found no video cards', {
      watchLinks: document.querySelectorAll('a[href*="/watch?v="]').length,
      shortsLinks: document.querySelectorAll('a[href*="/shorts/"]').length,
      knownCards: document.querySelectorAll(videoSelectors.join(',')).length,
      url: location.href,
    });
  }

  return candidates;
};

const observeHistoryPage = () => {
  if (!extensionEnabled || !isCurrentInstance() || !isYouTubeHistoryPage(location.pathname)) return;

  void safeStorageGet([STORAGE_KEYS.HISTORY_OBSERVATION_ENABLED]).then((result) => {
    if (!extensionEnabled || result[STORAGE_KEYS.HISTORY_OBSERVATION_ENABLED] !== true) return;
    const observation = collectHistoryEvidenceFromDom(document);
    console.info('Personal Algorithm history extraction diagnostic', {
      observedAt: observation.evidence[0]?.observedAt ?? new Date().toISOString(),
      scrollTop: Math.round(window.scrollY),
      viewportHeight: Math.round(window.innerHeight),
      scrollHeight: Math.round(document.documentElement.scrollHeight),
      metrics: observation.metrics,
    });
    if (observation.evidence.length === 0) return;
    safeSendMessage({
      type: EXTENSION_MESSAGE_TYPES.HISTORY_OBSERVATION,
      payload: observation,
    });
  });
};

const scheduleHistoryObservation = () => {
  if (historyObservationTimer !== undefined) window.clearTimeout(historyObservationTimer);
  historyObservationTimer = window.setTimeout(() => {
    historyObservationTimer = undefined;
    observeHistoryPage();
  }, 400);
};

const observeHomeRecommendations = () => {
  if (!extensionEnabled || !isCurrentInstance() || !isYouTubeHomePage(location.pathname)) return;
  safeStorageGet([STORAGE_KEYS.HOME_OBSERVATION_ENABLED]).then((result) => {
    if (!extensionEnabled || !isCurrentInstance() || result[STORAGE_KEYS.HOME_OBSERVATION_ENABLED] !== true) return;
    const observation = collectRecommendationObservationsFromDom(document);
    safeSendMessage({
      type: EXTENSION_MESSAGE_TYPES.RECOMMENDATION_OBSERVATION,
      payload: observation,
    });
  });
};

const scheduleHomeRecommendationObservation = () => {
  if (recommendationObservationTimer !== undefined) window.clearTimeout(recommendationObservationTimer);
  recommendationObservationTimer = window.setTimeout(() => {
    recommendationObservationTimer = undefined;
    observeHomeRecommendations();
  }, 400);
};

const getFeedLayoutItem = (element: HTMLElement): HTMLElement | null => {
  let current: HTMLElement | null = element;
  for (let depth = 0; current && depth < 10; depth += 1) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return current;
    if (parent.id === 'contents' && parent.closest('ytd-rich-grid-renderer')) {
      return current;
    }
    current = parent;
  }
  return null;
};

const syncSourceFilteredContainers = () => {
  document.querySelectorAll<HTMLElement>(
    '[data-personal-algorithm-source-shelf-hidden], [data-personal-algorithm-source-row-hidden]',
  ).forEach((container) => {
    container.style.removeProperty('display');
    delete container.dataset.personalAlgorithmSourceShelfHidden;
    delete container.dataset.personalAlgorithmSourceRowHidden;
  });

  const hideShelf = (shelf: HTMLElement, reason: 'shorts' | 'playables') => {
    const structuralHost = shelf.closest<HTMLElement>(
      'ytd-rich-section-renderer, ytd-item-section-renderer',
    );
    const layoutItem = getFeedLayoutItem(structuralHost ?? shelf);
    if (layoutItem) {
      layoutItem.dataset.personalAlgorithmSourceLayoutHidden = reason;
      layoutItem.style.setProperty('display', 'none', 'important');
    }
    if (structuralHost) {
      structuralHost.dataset.personalAlgorithmSourceSectionHidden = reason;
      structuralHost.style.setProperty('display', 'none', 'important');
      return;
    }
    shelf.dataset.personalAlgorithmSourceShelfHidden = reason;
    shelf.style.setProperty('display', 'none', 'important');
  };

  document.querySelectorAll<HTMLElement>(
    'ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-shelf-renderer',
  ).forEach((shelf) => {
    const reason = getSourceShelfHideReason({
      heading: shelf.querySelector<HTMLElement>(
        '#title, #title-container, h2, h3, yt-formatted-string',
      )?.textContent ?? '',
      hasShortsLink: Boolean(
        shelf.querySelector('a[href^="/shorts/"], a[href*="youtube.com/shorts/"]'),
      ),
      hasPlayableLink: Boolean(
        shelf.querySelector(
          'a[href*="/playables"], a[href*="playables?"], a[href*="/game/"]',
        ),
      ),
    }, sourceFilters);
    if (reason) hideShelf(shelf, reason);
  });

  // YouTube can retain an otherwise-empty rich-grid row after every card in it
  // has been source-filtered. Collapse only rows whose native card renderers are
  // all currently hidden by MyAlgo, so ordinary native layout remains untouched.
  document.querySelectorAll<HTMLElement>('ytd-rich-grid-row').forEach((row) => {
    const cards = Array.from(row.querySelectorAll<HTMLElement>('ytd-rich-item-renderer'));
    if (cards.length === 0) return;
    const everyCardHidden = cards.every((card) => (
      card.style.getPropertyValue('display') === 'none'
      && card.dataset.personalAlgorithmScore === 'source_filter'
    ));
    if (!everyCardHidden) return;
    row.dataset.personalAlgorithmSourceRowHidden = 'true';
    row.style.setProperty('display', 'none', 'important');
  });
};

const applyRankedFeed = () => {
  if (!isCurrentInstance()) return;
  const feedById = new Map(cachedFeed.map((item) => [item.external_id, item]));
  const feedByTitle = new Map(cachedFeed.map((item) => [normalizeText(item.title ?? ''), item]));
  const rankById = new Map(cachedFeed.map((item, index) => [item.external_id, index]));
  const knownElements = getVideoElements();
  const nativeCards = knownElements.map((element) => ({
    element,
    id: getVideoId(element),
    title: getVideoTitle(element),
    flags: getVideoSourceFlags(element),
  }));
  const replacementLimit = isYouTubeHomePage(location.pathname)
    ? replacementQuota(feedReplacementPercent, nativeCards.length)
    : 0;
  const replacementMinimumScore = youtubeConnector.presentation.replacementMinimumScore
    * (1 - feedReplacementPercent / 100);

  nativeCards.forEach(({ element, id, title, flags }, nativeIndex) => {
    element.style.removeProperty('display');
    element.style.outline = '';
    element.style.outlineOffset = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;
    delete element.dataset.personalAlgorithmSlotId;
    delete element.dataset.personalAlgorithmSlotWidth;
    element.querySelector('[data-personal-algorithm-badge]')?.remove();

    const item = feedById.get(id) ?? feedByTitle.get(title);
    const decision = getNativeCardDecision(item, {
      sourceFiltered: shouldHideForSourceFilters(flags, sourceFilters),
      // Keep an eligible native card until a specific replacement is ready.
      minimumVisibleScore: Number.NEGATIVE_INFINITY,
    });

    if (decision.action === 'hide') {
      const sourceVideoId = id;
      const slotWidth = element.getBoundingClientRect().width;
      if (
        replacementLimit > 0
        && isReplacementEligibleNativeDecision(decision)
        && !sourceVideoId.startsWith('title:')
        && slotWidth >= 120
        && element.parentElement
      ) {
        element.dataset.personalAlgorithmSlotId = createReplacementSlotId(rankGeneration, getRouteKey(), nativeIndex, sourceVideoId);
        element.dataset.personalAlgorithmSlotWidth = String(Math.round(slotWidth));
      }
      element.style.setProperty('display', 'none', 'important');
      element.dataset.personalAlgorithmScore = decision.reason;
      return;
    }

    if (!item) {
      // Degraded coverage is pass-through: MyAlgo must not erase a native card
      // merely because the local candidate pool did not produce a score for it.
      element.dataset.personalAlgorithmScore = 'unmatched';
      return;
    }

    const score = item.score ?? 0;
    element.dataset.personalAlgorithmScore = String(score);
    element.dataset.personalAlgorithmRank = String(rankById.get(item.external_id) ?? -1);
    element.style.outline = score >= 68 ? '2px solid rgba(20, 184, 166, 0.7)' : '';
    element.style.outlineOffset = score >= 68 ? '3px' : '';

    let badge = element.querySelector<HTMLElement>('[data-personal-algorithm-badge]');
    if (!badge) {
      badge = document.createElement('span');
      badge.dataset.personalAlgorithmBadge = 'true';
      badge.style.cssText = 'position:absolute;z-index:999;top:8px;left:8px;max-width:calc(100% - 16px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:5px 8px;border-radius:999px;background:#0f172a;color:#fff;font:700 11px/1.2 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;';
      const badgeHost = element.querySelector<HTMLElement>(
        '#thumbnail, ytd-thumbnail, yt-thumbnail-view-model, a#thumbnail',
      ) ?? element;
      const computedPosition = getComputedStyle(badgeHost).position;
      if (computedPosition === 'static') {
        badgeHost.style.position = 'relative';
        badgeHost.dataset.personalAlgorithmPositionPatched = 'true';
      }
      badgeHost.appendChild(badge);
    }
    const contentLabel = getContentPresentationLabel(item);
    badge.textContent = contentLabel
      ? `${contentLabel} · ${score}`
      : `MyAlgo · ${score}`;
  });

  // Swap eligible native cards only when a distinct, scored reservoir candidate
  // is already available. At 100%, fill as many safe Home slots as the pool can.
  const existingReplacementSlots = knownElements.filter((element) => Boolean(
    element.dataset.personalAlgorithmSlotId
    && element.style.getPropertyValue('display') === 'none',
  )).length;
  let remainingReplacementCapacity = Math.max(
    0,
    replacementLimit - existingReplacementSlots,
  );

  let stableReplacementAssignments = 0;
  let opportunisticReplacementCandidates = 0;
  let opportunisticNativeTargets = 0;
  let opportunisticSelectedTargets = 0;
  let opportunisticUpliftQualified = 0;

  if (remainingReplacementCapacity > 0) {
    const routeKey = getRouteKey();
    const nativeIds = new Set(
      nativeCards.map((card) => card.id).filter((id) => id && !id.startsWith('title:')),
    );
    const usedCandidateIds = new Set<string>();
    for (const sourceId of stableReplacementBySourceId.keys()) {
      if (!nativeIds.has(sourceId)) stableReplacementBySourceId.delete(sourceId);
    }

    // Keep a rendered replacement stable across ordinary YouTube DOM
    // churn while it remains eligible under the current feed mix.
    for (let nativeIndex = 0; nativeIndex < nativeCards.length && remainingReplacementCapacity > 0; nativeIndex += 1) {
      const { element, id } = nativeCards[nativeIndex];
      const sticky = stableReplacementBySourceId.get(id);
      if (!sticky) continue;
      if (sticky.routeKey !== routeKey) {
        stableReplacementBySourceId.delete(id);
        continue;
      }
      const item = feedById.get(sticky.candidateId) ?? sticky.item;
      const nativeScore = Number(element.dataset.personalAlgorithmScore);
      const candidateScore = item?.score ?? -Infinity;
      const valid = Boolean(
        item
        && !nativeIds.has(sticky.candidateId)
        && !usedCandidateIds.has(sticky.candidateId)
        && item.visible !== false
        && item.suppressed !== true
        && (item.policyOutcome == null || item.policyOutcome === 'eligible')
        && candidateScore >= replacementMinimumScore
        && Number.isFinite(nativeScore)
        && (feedReplacementPercent === 100 || candidateScore >= nativeScore)
        && element.parentElement
        && element.style.getPropertyValue('display') !== 'none'
      );
      if (!valid) {
        stableReplacementBySourceId.delete(id);
        continue;
      }

      const slotWidth = element.getBoundingClientRect().width;
      if (slotWidth < 120) continue;
      element.dataset.personalAlgorithmSlotId = createReplacementSlotId(
        rankGeneration,
        routeKey,
        nativeIndex,
        id,
      );
      element.dataset.personalAlgorithmSlotWidth = String(Math.round(slotWidth));
      element.dataset.personalAlgorithmReplacementCandidateId = sticky.candidateId;
      element.style.setProperty('display', 'none', 'important');
      element.dataset.personalAlgorithmScore = 'replacement_slot';
      usedCandidateIds.add(sticky.candidateId);
      stableReplacementAssignments += 1;
      remainingReplacementCapacity -= 1;
    }

    if (remainingReplacementCapacity > 0) {
      const replacementSelectionSeed = createReplacementSelectionSeed(routeKey);
      // Retrieved candidates receive no provenance bonus. The slider relaxes
      // the native-score uplift as it approaches full replacement.
      const replacementCandidates = getReplacementCandidates(
        cachedFeed,
        [...nativeIds, ...usedCandidateIds],
        Math.max(24, remainingReplacementCapacity * 6),
        replacementMinimumScore,
        replacementSelectionSeed,
      );
      const nativeTargets = nativeCards.flatMap(({ element, id }, nativeIndex) => {
        if (element.style.getPropertyValue('display') === 'none') return [];
        const score = Number(element.dataset.personalAlgorithmScore);
        if (!id || id.startsWith('title:') || !Number.isFinite(score)) return [];
        return [{ externalId: id, score, nativeIndex }];
      });

      const selectedAssignments = selectFeedMixAssignments(
        nativeTargets,
        replacementCandidates,
        remainingReplacementCapacity,
        feedReplacementPercent,
        youtubeConnector.presentation.replacementMinimumUplift,
      );

      opportunisticReplacementCandidates = replacementCandidates.length;
      opportunisticNativeTargets = nativeTargets.length;
      opportunisticSelectedTargets = selectedAssignments.length;
      opportunisticUpliftQualified = selectedAssignments.length;

      for (const assignment of selectedAssignments) {
        const selected = assignment.target;
        const element = knownElements[selected.nativeIndex];
        if (!element?.parentElement || element.style.getPropertyValue('display') === 'none') continue;
        const slotWidth = element.getBoundingClientRect().width;
        if (slotWidth < 120) continue;
        element.dataset.personalAlgorithmSlotId = createReplacementSlotId(
          rankGeneration,
          routeKey,
          selected.nativeIndex,
          selected.externalId,
        );
        element.dataset.personalAlgorithmSlotWidth = String(Math.round(slotWidth));
        element.dataset.personalAlgorithmReplacementCandidateId = assignment.item.external_id ?? '';
        element.style.setProperty('display', 'none', 'important');
        element.dataset.personalAlgorithmScore = 'replacement_slot';
      }
    }
  }

  syncSourceFilteredContainers();

  console.info('[MyAlgo] native presentation', {
    generation: rankGeneration,
    scoredCards: document.querySelectorAll('[data-personal-algorithm-score]').length,
    nativeBadges: document.querySelectorAll(
      '[data-personal-algorithm-score] [data-personal-algorithm-badge]',
    ).length,
    sourceFilteredCards: document.querySelectorAll(
      '[data-personal-algorithm-score="source_filter"]',
    ).length,
    hiddenSourceSections: document.querySelectorAll(
      '[data-personal-algorithm-source-section-hidden]',
    ).length,
    hiddenSourceRows: document.querySelectorAll(
      '[data-personal-algorithm-source-row-hidden]',
    ).length,
    hiddenSourceLayoutItems: document.querySelectorAll(
      '[data-personal-algorithm-source-layout-hidden]',
    ).length,
    stableReplacementAssignments,
    opportunisticReplacementCandidates,
    opportunisticNativeTargets,
    opportunisticSelectedTargets,
    retrievedDiscoveryExplorationAssignments: 0,
    feedReplacementPercent,
    replacementLimit,
    opportunisticUpliftQualified,
    replacementMinimumUplift: youtubeConnector.presentation.replacementMinimumUplift,
  });
};

const renderReplacementSlots = (generation: number) => {
  const existingReplacements = Array.from(
    document.querySelectorAll<HTMLElement>('[data-personal-algorithm-replacement]'),
  );
  if (!isCurrentInstance() || !extensionEnabled || isYouTubeHistoryPage(location.pathname)) {
    existingReplacements.forEach((element) => element.remove());
    return;
  }

  const nativeElements = getVideoElements();
  const replacementMinimumScore = youtubeConnector.presentation.replacementMinimumScore
    * (1 - feedReplacementPercent / 100);
  const targets = nativeElements.filter((element) => (
    Boolean(element.dataset.personalAlgorithmSlotId)
    && element.style.getPropertyValue('display') === 'none'
    && element.parentElement
  ));
  const slots = targets.map((element) => ({
    slotId: element.dataset.personalAlgorithmSlotId ?? '',
    sourceVideoId: getVideoId(element),
  }));

  const blockedIds = new Set<string>();
  nativeElements.map(getVideoId).forEach((id) => {
    if (id && !id.startsWith('title:')) blockedIds.add(id);
  });
  // Shelf candidates are separate visible placements and cannot be reused as
  // replacements. Existing replacement candidates are handled through bound
  // assignments below so their own source slot can retain them across reranks.
  document.querySelectorAll<HTMLElement>(
    '[data-personal-algorithm-shelf] [data-personal-algorithm-video-id]',
  ).forEach((element) => {
    const id = element.dataset.personalAlgorithmVideoId;
    if (id) blockedIds.add(id);
  });

  const replacementCandidateDiagnostics = {
    feed: cachedFeed.length,
    traced: cachedFeed.filter((item) => Boolean(item.traceId)).length,
    visible: cachedFeed.filter((item) => item.visible !== false).length,
    eligible: cachedFeed.filter((item) => (
      item.suppressed !== true
      && (item.policyOutcome == null || item.policyOutcome === 'eligible')
    )).length,
    positiveScore: cachedFeed.filter((item) => (
      (item.score ?? 0) >= replacementMinimumScore
    )).length,
  };
  const replacementQualifiedBeforeBlocking = cachedFeed.filter((item) => (
    Boolean(item.external_id && item.title && item.traceId)
    && item.visible !== false
    && item.suppressed !== true
    && (item.policyOutcome == null || item.policyOutcome === 'eligible')
    && (item.score ?? 0) >= replacementMinimumScore
  )).length;
  const targetBySlot = new Map(targets.map((element) => [element.dataset.personalAlgorithmSlotId ?? '', element]));
  const feedById = new Map(cachedFeed.map((item) => [item.external_id, item]));
  const boundAssignments = slots.flatMap((slot) => {
    const target = targetBySlot.get(slot.slotId);
    const candidateId = target?.dataset.personalAlgorithmReplacementCandidateId?.trim();
    const item = candidateId ? feedById.get(candidateId) : undefined;
    if (
      !item
      || blockedIds.has(candidateId ?? '')
      || item.visible === false
      || item.suppressed === true
      || (item.policyOutcome != null && item.policyOutcome !== 'eligible')
      || (item.score ?? 0) < replacementMinimumScore
    ) {
      return [];
    }
    return [{ slot, item }];
  });
  const boundSlotIds = new Set(boundAssignments.map((assignment) => assignment.slot.slotId));
  const boundCandidateIds = new Set(boundAssignments.map((assignment) => assignment.item.external_id));
  const fallbackAssignments = planReplacementAssignments(
    cachedFeed,
    slots.filter((slot) => !boundSlotIds.has(slot.slotId)),
    [...blockedIds, ...boundCandidateIds],
    replacementMinimumScore,
    createReplacementSelectionSeed(getRouteKey()),
  );
  const assignments = [...boundAssignments, ...fallbackAssignments]
    .slice(0, isYouTubeHomePage(location.pathname)
      ? replacementQuota(feedReplacementPercent, nativeElements.length)
      : 0);
  const existingBySourceId = new Map<string, HTMLElement>();
  for (const replacement of existingReplacements) {
    const sourceId = replacement.dataset.personalAlgorithmReplacementSourceVideoId?.trim();
    if (sourceId && !existingBySourceId.has(sourceId)) existingBySourceId.set(sourceId, replacement);
  }
  const retainedReplacements = new Set<HTMLElement>();
  let filled = 0;
  let reused = 0;

  for (const assignment of assignments) {
    const target = targetBySlot.get(assignment.slot.slotId);
    if (
      !target
      || !target.isConnected
      || target.style.getPropertyValue('display') !== 'none'
      || target.dataset.personalAlgorithmSlotId !== assignment.slot.slotId
      || !target.parentElement
    ) {
      continue;
    }

    const existing = existingBySourceId.get(assignment.slot.sourceVideoId);
    const replacementVideoId = assignment.item.external_id ?? '';
    const replacementScore = String(assignment.item.score ?? 0);
    const replacementTraceId = assignment.item.traceId ?? '';
    if (
      existing
      && existing.isConnected
      && existing.dataset.personalAlgorithmVideoId === replacementVideoId
      && existing.dataset.personalAlgorithmTraceId === replacementTraceId
      && existing.dataset.personalAlgorithmReplacementScore === replacementScore
    ) {
      existing.dataset.personalAlgorithmReplacementSlot = assignment.slot.slotId;
      existing.dataset.personalAlgorithmReplacementGeneration = String(generation);
      if (existing.parentElement !== target.parentElement || target.previousElementSibling !== existing) {
        target.parentElement.insertBefore(existing, target);
      }
      retainedReplacements.add(existing);
      reused += 1;
      filled += 1;
    } else {
      existing?.remove();
      const replacement = createReplacementCard(
        assignment.item,
        target,
        assignment.slot.slotId,
        assignment.slot.sourceVideoId,
        generation,
      );
      target.parentElement.insertBefore(replacement, target);
      retainedReplacements.add(replacement);
      filled += 1;
    }

    stableReplacementBySourceId.set(assignment.slot.sourceVideoId, {
      candidateId: replacementVideoId,
      item: assignment.item,
      routeKey: getRouteKey(),
    });
  }

  for (const replacement of existingReplacements) {
    if (!retainedReplacements.has(replacement)) replacement.remove();
  }

  console.info('[MyAlgo] replacement slots', {
    generation,
    eligibleSlots: slots.length,
    filled,
    reused,
    unfilled: Math.max(0, slots.length - filled),
    qualifiedBeforeBlocking: replacementQualifiedBeforeBlocking,
    assignableAfterBlocking: assignments.length,
    blockedNativeIds: blockedIds.size,
    offPageCandidates: cachedFeed.filter((item) => item.external_id && !blockedIds.has(item.external_id)).length,
    boundAssignments: boundAssignments.length,
    fallbackAssignments: fallbackAssignments.length,
    candidates: replacementCandidateDiagnostics,
  });
};

const scheduleRankGeneration = (generation: number, delayMs = 320) => {
  if (rankTimer !== undefined) window.clearTimeout(rankTimer);
  rankTimer = window.setTimeout(() => {
    rankTimer = undefined;
    if (!isCurrentInstance() || !extensionEnabled) return;
    if (rankingInFlight) {
      rankQueued = true;
      return;
    }
    void rankCurrentPage(generation);
  }, delayMs);
};

const scheduleLatestRank = () => {
  rankQueued = false;
  scheduleRankGeneration(rankGeneration, 120);
};

const rankCurrentPage = async (requestGeneration: number) => {
  if (!isCurrentInstance() || !extensionEnabled || isYouTubeHistoryPage(location.pathname)) return;
  if (rankingInFlight) {
    rankQueued = true;
    return;
  }

  const requestRouteKey = getRouteKey();
  const candidates = collectCandidates();
  if (candidates.length === 0) {
    showStatus(`Personal Algorithm: no cards on ${location.hostname}`, true);
    return;
  }

  rankingInFlight = true;
  showStatus(`Personal Algorithm: ranking ${candidates.length} videos`);
  const requestMode = activeMode;
  const requestContext = { generation: requestGeneration, routeKey: requestRouteKey, mode: requestMode };
  const currentContext = { generation: rankGeneration, routeKey: getRouteKey(), mode: activeMode };
  if (isRenderContextStale(requestContext, currentContext)) {
    rankingInFlight = false;
    logStaleRender('before-request', requestGeneration);
    scheduleLatestRank();
    return;
  }

  const candidateSignature = candidates.map((candidate) => candidate.external_id).sort().join('|');
  if (candidateSignature === lastCandidateSignature && activeMode === lastRankMode && cachedFeed.length > 0) {
    // Reuse the already-scored feed for presentation, but do not skip semantic
    // enrichment. A warm feed cache can outlive semantic caches (for example
    // after a model-mode switch or extension update), and previously this early
    // return meant no semantic pass/diagnostics would ever be produced.
    safeSendMessage({
      type: 'REFRESH_SEMANTICS',
      payload: { mode: requestMode, candidates },
    });
    rankingInFlight = false;
    applyRankedFeed();
    clearLegacyRecommendationShelf();
    renderReplacementSlots(rankGeneration);
    if (rankQueued) scheduleLatestRank();
    return;
  }

  safeSendMessage({ type: 'RANK_PAGE', payload: { mode: requestMode, candidates } }, (response) => {
    rankingInFlight = false;
    const latestContext = { generation: rankGeneration, routeKey: getRouteKey(), mode: activeMode };
    if (!isCurrentInstance() || isRenderContextStale(requestContext, latestContext)) {
      if (isCurrentInstance()) logStaleRender('rank-response', requestGeneration);
      if (isCurrentInstance() && extensionEnabled) scheduleLatestRank();
      return;
    }

    if (response?.ok && Array.isArray(response.feed)) {
      console.info('[MyAlgo] rank response', {
        generation: requestGeneration,
        pageCandidates: candidates.length,
        feed: response.feed.length,
        backgroundElapsedMs: response.elapsedMs ?? null,
        rankingWorkingSetSize: response.rankingWorkingSetSize ?? null,
        replacementInventorySize: response.replacementInventorySize ?? null,
        searchCandidatesScored: response.searchCandidatesScored ?? null,
        searchCandidatesQualified: response.searchCandidatesQualified ?? null,
        searchCandidatesInReplacementInventory: response.searchCandidatesInReplacementInventory ?? null,
        maxSearchCandidateScore: response.maxSearchCandidateScore ?? null,
        enrichmentPending: response.enrichmentPending === true,
      });
      cachedFeed = response.feed;
      lastCandidateSignature = candidateSignature;
      lastRankMode = requestMode;

      // Preserve valid replacement nodes through ordinary reranks so the
      // source→candidate binding can be reused instead of visually torn down.
      // Hard lifecycle/policy changes remove replacements before reaching this
      // response path.
      clearExtensionPresentation(false, true);
      applyRankedFeed();
      clearLegacyRecommendationShelf();
      renderReplacementSlots(requestGeneration);

      const visibleCount = response.feed.filter((item: RankedFeedItem) => (
        item.visible !== false
        && item.suppressed !== true
        && (item.policyOutcome == null || item.policyOutcome === 'eligible')
        && (item.score ?? 0) >= youtubeConnector.presentation.minimumVisibleScore
      )).length;
      showStatus(`MyAlgo: ${visibleCount} scored visible · ${response.feed.length - visibleCount} scored hidden`);
    } else {
      console.warn('[MyAlgo] native feed ranking failed', { phase: 'rank-response' });
      showStatus(`Personal Algorithm: ${response?.error ?? 'ranking failed'}`, true);
    }
    if (rankQueued) scheduleLatestRank();
  });
};

const triggerRank = (
  reason: 'navigation' | 'mutation' | 'metadata' | 'semantic' | 'mode' | 'feedback' | 'graph' | 'manual' = 'manual',
) => {
  if (!isCurrentInstance() || !extensionEnabled || isYouTubeHistoryPage(location.pathname)) return;

  if (reason !== 'mutation' && reason !== 'metadata' && reason !== 'semantic') {
    if (reason === 'navigation' || reason === 'mode' || reason === 'feedback' || reason === 'graph') {
      clearStableReplacements();
    }
    document.querySelectorAll<HTMLElement>('[data-personal-algorithm-replacement]').forEach((element) => element.remove());
  }

  if (reason === 'metadata' || reason === 'semantic') {
    // Force a new score pass because cached watch metadata changed, but keep
    // stable replacement assignments until the new scores actually render.
    lastCandidateSignature = '';
  }

  if (rankingInFlight) {
    rankQueued = true;
    // Ordinary feed churn must not invalidate the response already in flight;
    // otherwise a continuously mutating YouTube Home page can starve MyAlgo
    // indefinitely and never paint badges/replacements. Hard semantic/lifecycle
    // changes still invalidate the active generation.
    if (reason !== 'mutation' && reason !== 'metadata' && reason !== 'semantic') {
      rankGeneration += 1;
    }
    return;
  }

  const generation = ++rankGeneration;
  const delayMs = reason === 'mutation'
    ? 320
    : reason === 'metadata' || reason === 'semantic'
      ? 120
      : 60;
  scheduleRankGeneration(generation, delayMs);
};
const scheduleInitialRank = (attempt = 0) => {
  if (!extensionEnabled || !isCurrentInstance() || isYouTubeHistoryPage(location.pathname)) return;
  window.setTimeout(() => {
    if (!extensionEnabled || !isCurrentInstance()) return;
    const currentCandidates = collectCandidates();
    if (currentCandidates.length >= 2) {
      triggerRank('manual');
      return;
    }
    if (attempt < 8) scheduleInitialRank(attempt + 1);
  }, attempt === 0 ? 40 : 180);
};

safeStorageGet([
  STORAGE_KEYS.MODE,
  STORAGE_KEYS.ENABLED,
  STORAGE_KEYS.SOURCE_FILTERS,
  STORAGE_KEYS.FEED_REPLACEMENT_PERCENT,
  STORAGE_KEYS.PRIVACY_DISCLOSURE_ACCEPTED_VERSION,
]).then((result) => {
  activeMode = (result[STORAGE_KEYS.MODE] as string) ?? activeMode;
  sourceFilters = result[STORAGE_KEYS.SOURCE_FILTERS] as FeedSourceFilters | undefined ?? {};
  const storedPercent = Number(result[STORAGE_KEYS.FEED_REPLACEMENT_PERCENT] ?? 0);
  feedReplacementPercent = Number.isFinite(storedPercent)
    ? Math.max(0, Math.min(100, storedPercent)) : 0;
  const disclosureAccepted = isPrivacyDisclosureAccepted(
    result[STORAGE_KEYS.PRIVACY_DISCLOSURE_ACCEPTED_VERSION],
  );
  extensionEnabled = disclosureAccepted
    && result[STORAGE_KEYS.ENABLED] !== false;
  if (!extensionEnabled) {
    clearExtensionPresentation(false);
    return;
  }

  // Apply persisted presentation controls before the initial rank request so
  // Home starts in the user's chosen shape instead of flashing unfiltered UI.
  applyRankedFeed();
  showStatus('Personal Algorithm: Active', false, false);
  clearLegacyRecommendationShelf();
  scheduleInitialRank();
});

const sourceFiltersEqual = (left: FeedSourceFilters, right: FeedSourceFilters) => (
  left.subscribedOnly === right.subscribedOnly
  && left.includeDiscovery === right.includeDiscovery
  && left.includeShorts === right.includeShorts
  && left.includeLive === right.includeLive
  && left.includePlayables === right.includePlayables
);

const applySourceFilters = (nextFilters: FeedSourceFilters) => {
  if (!isCurrentInstance() || sourceFiltersEqual(sourceFilters, nextFilters)) return;
  sourceFilters = nextFilters;
  rankGeneration += 1;

  // Keep the last valid scored generation available for the optimistic local
  // presentation pass. Source controls are presentation policy, so clearing
  // cachedFeed here would remove mode/score badges until a later rank response
  // wins the generation race.
  clearExtensionPresentation(false);
  applyRankedFeed();

  // Force a fresh score/trace request after the immediate presentation update.
  // The generation guard prevents older in-flight work from replacing it.
  lastCandidateSignature = '';
  lastRankMode = '';
  triggerRank('mode');
};

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !isCurrentInstance()) return;
  const nextFilters = changes[STORAGE_KEYS.SOURCE_FILTERS]?.newValue as FeedSourceFilters | undefined;
  if (nextFilters) applySourceFilters(nextFilters);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCurrentInstance()) return;
  if (message?.type === 'YOUTUBE_METADATA_ENRICHED') {
    if (extensionEnabled) triggerRank('metadata');
    return;
  }
  if (message?.type === 'YOUTUBE_SEMANTICS_ENRICHED') {
    if (extensionEnabled) triggerRank('semantic');
    return;
  }
  if (message?.type === 'EXTENSION_ENABLED' && typeof message.payload?.enabled === 'boolean') {
    extensionEnabled = message.payload.enabled;
    rankGeneration += 1;
    if (rankTimer !== undefined) window.clearTimeout(rankTimer);
    rankTimer = undefined;
    rankQueued = false;
    cachedFeed = [];
    lastCandidateSignature = '';
    lastRankMode = '';
    clearExtensionPresentation(!extensionEnabled);

    if (extensionEnabled) {
      // Activation is a hard lifecycle boundary. Do not let an in-flight
      // request from before the pause strand the clean page waiting for its
      // callback; its generation is already stale and cannot render.
      rankingInFlight = false;
      void safeStorageGet([STORAGE_KEYS.MODE]).then((result) => {
        if (!isCurrentInstance() || !extensionEnabled) return;
        activeMode = (result[STORAGE_KEYS.MODE] as string) ?? activeMode;
        showStatus(`Personal Algorithm: Active · ${activeMode}`, false, false);
        clearLegacyRecommendationShelf();
        triggerRank('manual');
      });
    }
    return;
  }
  if (message?.type === 'SOURCE_FILTERS_CHANGED') {
    const nextFilters = message.payload?.sourceFilters as FeedSourceFilters | undefined;
    if (nextFilters) {
      applySourceFilters(nextFilters);
      clearLegacyRecommendationShelf();
      return;
    }
    void safeStorageGet([STORAGE_KEYS.SOURCE_FILTERS]).then((result) => {
      applySourceFilters(
        result[STORAGE_KEYS.SOURCE_FILTERS] as FeedSourceFilters | undefined ?? {},
      );
      clearLegacyRecommendationShelf();
    });
    return;
  }
  if (message?.type === 'FEED_REPLACEMENT_CHANGED') {
    const next = Number(message.payload?.percent);
    if (!Number.isFinite(next) || next === feedReplacementPercent) return;
    feedReplacementPercent = Math.max(0, Math.min(100, next));
    clearStableReplacements();
    rankGeneration += 1;
    clearExtensionPresentation(false);
    applyRankedFeed();
    renderReplacementSlots(rankGeneration);
    triggerRank('manual');
    return;
  }
  if (message?.type === 'PERSONAL_ALGORITHM_CHANGED') {
    clearStableReplacements();
    rankGeneration += 1;
    cachedFeed = [];
    lastCandidateSignature = '';
    lastRankMode = '';
    clearExtensionPresentation(false);
    triggerRank('graph');
    return;
  }
  if (message?.type !== 'MODE_CHANGED' || typeof message.payload?.mode !== 'string') return;
  clearStableReplacements();
  rankGeneration += 1;
  activeMode = message.payload.mode;
  cachedFeed = [];
  lastCandidateSignature = '';
  lastRankMode = '';
  clearExtensionPresentation(false);
  clearLegacyRecommendationShelf();
  triggerRank('mode');
});

const isWatchPage = () => location.pathname === '/watch' || location.pathname.startsWith('/shorts/');

const isYouTubeAdShowing = () => Boolean(
  document.querySelector('#movie_player.ad-showing, .html5-video-player.ad-showing'),
);

const getActiveWatchVideo = (): HTMLVideoElement | null => {
  if (!isWatchPage() || isYouTubeAdShowing()) return null;
  const player = document.querySelector<HTMLElement>('#movie_player, ytd-player .html5-video-player');
  const video = player?.querySelector<HTMLVideoElement>('video.html5-main-video, video')
    ?? document.querySelector<HTMLVideoElement>('video.html5-main-video');
  return video;
};

const emitTemporalWatch = (ended = false) => {
  if (!watchSession) return;
  const observation = createTemporalWatchObservation(
    watchSession,
    new Date().toISOString(),
    ended,
  );
  if (!observation) return;
  watchSession = markWatchEmitted(watchSession);
  safeSendMessage({
    type: EXTENSION_MESSAGE_TYPES.WATCH_OBSERVATION,
    payload: { observation },
  });
};

const attachTemporalWatchObserver = () => {
  if (!extensionEnabled || !isCurrentInstance()) return;
  const video = getActiveWatchVideo();
  if (!video) return;
  if (video === watchedVideo) return;

  watchedVideo = video;
  const videoId = youtubeConnector.getExternalId(location.href);
  if (!videoId) {
    watchSession = null;
    return;
  }

  const pendingSelectionIsFresh = pendingWatchExposure
    && Date.now() - pendingWatchExposure.observedAt <= WATCH_SELECTION_INTENT_MAX_AGE_MS;
  const selectedExposure = pendingSelectionIsFresh && pendingWatchExposure?.videoId === videoId
    ? pendingWatchExposure.exposureId
    : null;
  if (pendingWatchExposure?.videoId === videoId) {
    pendingWatchExposure = null;
  }

  watchSessionSequence += 1;
  watchSession = createWatchSession({
    videoId,
    exposureId: selectedExposure,
    sessionId: `${videoId}|player|${watchSessionSequence}`,
    currentTime: video.currentTime,
    durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
  });

  const update = () => {
    if (video !== watchedVideo || !watchSession) return;
    watchSession = advanceWatchSession(watchSession, {
      currentTime: video.currentTime,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
      isPlaying: !video.paused && !video.ended && !isYouTubeAdShowing(),
      isSeeking: video.seeking,
    });
    emitTemporalWatch();
  };

  const onSeeking = () => {
    if (!watchSession) return;
    watchSession = {
      ...advanceWatchSession(watchSession, {
        currentTime: video.currentTime,
        durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
        isPlaying: false,
        isSeeking: true,
      }),
      seeking: true,
    };
  };

  const onSeeked = () => {
    if (!watchSession) return;
    watchSession = resetWatchSeek(watchSession, video.currentTime);
  };

  const onEnded = () => {
    if (!watchSession) return;
    watchSession = advanceWatchSession(watchSession, {
      currentTime: video.currentTime,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
      isPlaying: true,
    });
    emitTemporalWatch(true);
  };

  video.addEventListener('timeupdate', update);
  video.addEventListener('playing', update);
  video.addEventListener('pause', update);
  video.addEventListener('waiting', update);
  video.addEventListener('seeking', onSeeking);
  video.addEventListener('seeked', onSeeked);
  video.addEventListener('ended', onEnded);
};

const FEEDBACK_CONTEXT_MAX_AGE_MS = 5000;

let pendingFeedbackContext: { contentItemId: string; openedAt: number } | null = null;

const getFeedbackEventType = (element: Element) => {
  const label = normalizeText(
    element.textContent
      ?? element.getAttribute('aria-label')
      ?? element.getAttribute('title')
      ?? '',
  );
  if (label.includes('more like this')) return 'more_like_this';
  if (label.includes('never show')) return 'never_show_channel';
  if (label.includes('not interested')) return 'not_interested';
  return null;
};

const getMoreActionsTrigger = (target: Element) => {
  const candidate = target.closest(
    'button, yt-icon-button, tp-yt-paper-icon-button, ytd-menu-renderer, #button',
  );
  if (!candidate) return null;

  const label = normalizeText(
    candidate.getAttribute('aria-label')
      ?? candidate.getAttribute('title')
      ?? candidate.textContent
      ?? '',
  );

  return label.includes('more actions') || label === 'more' || label.includes('options')
    ? candidate
    : null;
};

const registerFeedbackHandlers = () => {
  if (!isCurrentInstance()) return;

  document.addEventListener('click', (event) => {
    if (!isCurrentInstance() || !extensionEnabled) return;

    const target = event.target instanceof Element ? event.target : null;
    if (!target || isMyAlgoInjectedElement(target)) return;

    const trigger = getMoreActionsTrigger(target);
    if (trigger) {
      const card = trigger.closest(
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer',
      ) as HTMLElement | null;
      const contentItemId = card ? getVideoId(card) : '';
      if (contentItemId && !contentItemId.startsWith('title:')) {
        pendingFeedbackContext = {
          contentItemId,
          openedAt: Date.now(),
        };
      }
      return;
    }

    const eventType = getFeedbackEventType(target);
    if (!eventType) return;

    const context = pendingFeedbackContext;
    pendingFeedbackContext = null;
    if (!context || Date.now() - context.openedAt > FEEDBACK_CONTEXT_MAX_AGE_MS) return;

    safeSendMessage({
      type: EXTENSION_MESSAGE_TYPES.FEEDBACK,
      payload: {
        contentItemId: context.contentItemId,
        eventType,
      },
    });
  }, true);
};

registerFeedbackHandlers();

window.addEventListener('load', () => {
  scheduleInitialRank();
  clearLegacyRecommendationShelf();
  scheduleHomeRecommendationObservation();
  attachTemporalWatchObserver();
});
window.addEventListener('yt-navigate-start', () => {
  clearStableReplacements();
  if (mutationRankTimer !== undefined) {
    window.clearTimeout(mutationRankTimer);
    mutationRankTimer = undefined;
  }
  watchedVideo = null;
  watchSession = null;
  rankGeneration += 1;
  cachedFeed = [];
  lastCandidateSignature = '';
  lastRankMode = '';
  clearExtensionPresentation(false);
});
window.addEventListener('yt-navigate-finish', () => {
  attachTemporalWatchObserver();
  const currentVideoId = youtubeConnector.getExternalId(window.location.href);
    if (currentVideoId) sendActivity(currentVideoId, 'revisited');
  if (isYouTubeHistoryPage(location.pathname)) {
    scheduleHistoryObservation();
  } else {
    clearLegacyRecommendationShelf();
    triggerRank('navigation');
    scheduleHomeRecommendationObservation();
  }
});
window.addEventListener('yt-page-data-updated', () => {
  // YouTube emits this during ordinary in-route Home refreshes as well as
  // navigation-adjacent updates. The actual navigation lifecycle already
  // clears state on yt-navigate-start, so treat this as mutation churn here.
  triggerRank('mutation');
});
window.addEventListener('popstate', () => {
  if (!isYouTubeHistoryPage(location.pathname)) triggerRank('navigation');
  else scheduleHistoryObservation();
});
window.addEventListener('resize', () => {
  if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = undefined;
    clearLegacyRecommendationShelf();
  }, 120);
});

const pageObserver = new MutationObserver((records) => {
  const hasNativeVideoMutation = records.some((record) => Array.from(record.addedNodes).some((node) => {
    if (!(node instanceof Element)) return false;
    if (node.closest(MYALGO_INJECTED_SELECTOR)) return false;
    return node.matches(`${videoSelectors.join(',')}, ${videoLinkSelector}`)
      || Boolean(node.querySelector(`${videoSelectors.join(',')}, ${videoLinkSelector}`));
  }));

  if (hasNativeVideoMutation) {
    if (
      sourceFilters.includeShorts === false
      || sourceFilters.includeLive === false
    ) {
      // Keep explicit source controls responsive while YouTube recycles or
      // appends native cards; fresh scoring can follow asynchronously.
      applyRankedFeed();
    }

    // YouTube can emit dozens of subtree mutations for one visual feed update.
    // Coalesce them before collecting/scoring the DOM rather than invoking
    // collectCandidates() for every observer callback.
    if (mutationRankTimer !== undefined) window.clearTimeout(mutationRankTimer);
    mutationRankTimer = window.setTimeout(() => {
      mutationRankTimer = undefined;
      if (isCurrentInstance() && extensionEnabled) triggerRank('mutation');
    }, 450);
  }

  const hasSourceShelfMutation = records.some((record) => Array.from(record.addedNodes).some((node) => {
    if (!(node instanceof Element)) return false;
    return node.matches('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-shelf-renderer')
      || Boolean(node.querySelector('ytd-rich-shelf-renderer, ytd-reel-shelf-renderer, ytd-shelf-renderer'));
  }));
  if (hasSourceShelfMutation && (
    sourceFilters.includeShorts === false
    || sourceFilters.includePlayables === false
  )) {
    syncSourceFilteredContainers();
  }

  if (isYouTubeHistoryPage(location.pathname)) scheduleHistoryObservation();
  if (isYouTubeHomePage(location.pathname)) scheduleHomeRecommendationObservation();
  attachTemporalWatchObserver();
});
pageObserver.observe(document.documentElement, { childList: true, subtree: true });

window.setInterval(() => {
  if (isWatchPage()) attachTemporalWatchObserver();
}, 2500);

const recordSelection = (event: MouseEvent | KeyboardEvent, kind: 'click' | 'auxclick' | 'keyboard') => {
  if (!isCurrentInstance() || !extensionEnabled) return;
  const target = event.target instanceof Element ? event.target : null;
  const selection = getSelectionFromTarget(target, videoSelectors.join(','), location.pathname);
  if (!selection || selection.videoId.startsWith('title:')) return;
  const observation = createSelectionObservation(selection, kind);
  const now = Date.now();
  const signature = `${observation.videoId}|${observation.exposureId ?? ''}`;
  if (
    lastSelectionInteraction &&
    lastSelectionInteraction.signature === signature &&
    lastSelectionInteraction.kind !== kind &&
    now - lastSelectionInteraction.at < 750
  ) {
    return;
  }
  lastSelectionInteraction = { signature, kind, at: now };
  pendingWatchExposure = {
    videoId: observation.videoId,
    exposureId: observation.exposureId,
    observedAt: now,
  };
  safeSendMessage({
    type: EXTENSION_MESSAGE_TYPES.SELECTION_OBSERVATION,
    payload: { observation },
  });
};

document.addEventListener('click', (event) => recordSelection(event, 'click'), true);
document.addEventListener('auxclick', (event) => recordSelection(event, 'auxclick'), true);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  recordSelection(event, 'keyboard');
}, true);

scheduleHistoryObservation();
scheduleHomeRecommendationObservation();
