import { STORAGE_KEYS } from '../lib/storage';
import { EXTENSION_MESSAGE_TYPES } from '../lib/messaging';
import { MYALGO_INJECTED_SELECTOR, dedupeCandidatesById, getNativeCardDecision, getShelfCandidates, isMyAlgoInjectedElement, isRenderContextStale, keepOutermostElements, shouldHideForSourceFilters } from './youtube-ux';
import type { RankedFeedItem } from './youtube-ux';
import { youtubeConnector } from '../connectors/youtube';
import type { FeedSourceFilters } from '@repo/shared-types';
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
let personalPicks: RankedFeedItem[] = [];
let rankingInFlight = false;
let activeMode = 'Work';
let rankGeneration = 0;
let rankTimer: number | undefined;
let rankQueued = false;
let feedRequestGeneration = 0;
let statusDismissTimer: number | undefined;
let resizeTimer: number | undefined;
let historyObservationTimer: number | undefined;
let recommendationObservationTimer: number | undefined;
let extensionEnabled = false;
let lastCandidateSignature = '';
let lastRankMode = '';
let sourceFilters: FeedSourceFilters = {};
let lastSelectionInteraction: { signature: string; kind: 'click' | 'auxclick' | 'keyboard'; at: number } | null = null;
const WATCH_SELECTION_INTENT_MAX_AGE_MS = 15_000;
let pendingWatchExposure: { videoId: string; exposureId: string | null; observedAt: number } | null = null;
let watchedVideo: HTMLVideoElement | null = null;
let watchSession: WatchSessionState | null = null;
let watchSessionSequence = 0;

const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const instanceAttribute = 'data-personal-algorithm-instance';
document.documentElement.setAttribute(instanceAttribute, instanceId);

const isCurrentInstance = () => document.documentElement.getAttribute(instanceAttribute) === instanceId;
const getRouteKey = () => `${location.pathname}${location.search}`;

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

const clearExtensionPresentation = (showPaused = true) => {
  document.querySelector('[data-personal-algorithm-shelf]')?.remove();
  document.querySelectorAll<HTMLElement>(
    '[data-personal-algorithm-replacement], [data-personal-algorithm-explanation], [data-personal-algorithm-control]',
  ).forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-badge]').forEach((badge) => badge.remove());
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-score]').forEach((element) => {
    element.style.removeProperty('display');
    element.style.outline = '';
    element.style.outlineOffset = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;
    if (element.dataset.personalAlgorithmPositionPatched === 'true') {
      element.style.removeProperty('position');
      delete element.dataset.personalAlgorithmPositionPatched;
    }
  });
  if (showPaused) {
    showStatus('Personal Algorithm: Paused', false, true);
  } else {
    document.querySelector('[data-personal-algorithm-status]')?.remove();
  }
};

const createThumbnail = (item: RankedFeedItem): HTMLElement => {
  const media = item.thumbnail_url ? document.createElement('img') : document.createElement('div');
  if (media instanceof HTMLImageElement) {
    media.src = item.thumbnail_url ?? '';
    media.alt = '';
    media.loading = 'lazy';
  } else {
    media.setAttribute('aria-hidden', 'true');
  }
  media.style.cssText = `display:block;width:100%;aspect-ratio:${youtubeConnector.presentation.horizontalAspectRatio};object-fit:cover;border-radius:10px;background:var(--yt-spec-10-percent-layer, #e5e5e5);`;
  return media;
};

const syncShelfCardWidth = (cards: HTMLElement) => {
  const nativeCardWidth = getVideoElements()
    .map((element) => element.getBoundingClientRect().width)
    .find((width) => width >= 160);
  const shelfCardWidth = nativeCardWidth
    ? `${Math.round(nativeCardWidth)}px`
    : 'min(320px, 80vw)';
  cards.style.gridAutoColumns = shelfCardWidth;
};

const renderRecommendationShelf = (attempt = 0) => {
  if (!isCurrentInstance() || !extensionEnabled) return;

  const feedRenderer = document.querySelector<HTMLElement>(
    'ytd-rich-grid-renderer, ytd-two-column-browse-results-renderer #primary',
  );
  const feedContents = feedRenderer?.querySelector<HTMLElement>('#contents');
  const shelfHost = feedRenderer?.parentElement;
  if (!feedRenderer || !feedContents || !shelfHost) {
    if (attempt < 10) window.setTimeout(() => renderRecommendationShelf(attempt + 1), 500);
    return;
  }

  const nativeIds = getVideoElements().map(getVideoId);
  const picks = getShelfCandidates(
    personalPicks,
    youtubeConnector.presentation.shelfBatchSize,
    nativeIds,
    youtubeConnector.presentation.minimumVisibleScore,
  );
  if (picks.length === 0) {
    document.querySelector('[data-personal-algorithm-shelf]')?.remove();
    return;
  }

  let shelf = document.querySelector<HTMLElement>('[data-personal-algorithm-shelf]');
  if (shelf && shelf.parentElement !== shelfHost) {
    shelf.remove();
    shelf = null;
  }
  if (!shelf) {
    shelf = document.createElement('section');
    shelf.dataset.personalAlgorithmShelf = 'true';
    shelf.style.cssText = 'display:block;position:relative;clear:both;float:none;width:100%;max-width:100%;min-width:0;box-sizing:border-box;overflow:hidden;contain:layout paint;margin:16px 0 24px;padding:16px 0;border-top:1px solid var(--yt-spec-10-percent-layer, #e5e5e5);border-bottom:1px solid var(--yt-spec-10-percent-layer, #e5e5e5);font-family:Roboto,Arial,sans-serif;';
    shelfHost.insertBefore(shelf, feedRenderer);
  }

  shelf.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = `Personal picks · ${activeMode}`;
  heading.style.cssText = 'margin:0 16px 12px;font-size:20px;line-height:28px;color:var(--yt-spec-text-primary, #0f0f0f);';
  shelf.appendChild(heading);

  const cards = document.createElement('div');
  cards.style.cssText = 'display:grid;grid-auto-flow:column;gap:16px;width:100%;max-width:100%;min-width:0;box-sizing:border-box;overflow-x:auto;overflow-y:hidden;overscroll-behavior-inline:contain;scroll-snap-type:inline mandatory;scrollbar-width:none;padding:0 16px 8px;';
  syncShelfCardWidth(cards);
  for (const item of picks) {
    const card = document.createElement('a');
    card.href = youtubeConnector.getCanonicalUrl(item.external_id ?? '');
    card.dataset.personalAlgorithmVideoId = item.external_id ?? '';
    card.style.cssText = 'display:block;min-width:0;scroll-snap-align:start;color:var(--yt-spec-text-primary, #0f0f0f);text-decoration:none;';

    card.appendChild(createThumbnail(item));

    const title = document.createElement('div');
    title.textContent = item.title ?? 'Recommended video';
    title.style.cssText = 'margin-top:8px;font-size:14px;font-weight:600;line-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;';
    card.appendChild(title);

    const channel = document.createElement('div');
    channel.textContent = item.channel_name ?? `${activeMode} pick`;
    channel.style.cssText = 'margin-top:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--yt-spec-text-secondary, #606060);font-size:12px;line-height:18px;';
    card.appendChild(channel);
    cards.appendChild(card);
  }
  shelf.appendChild(cards);
  window.requestAnimationFrame(() => {
    if (cards.isConnected) syncShelfCardWidth(cards);
  });
};

const refreshRecommendationShelf = () => {
  if (isYouTubeHistoryPage(location.pathname)) return;
  const requestGeneration = ++feedRequestGeneration;
  safeSendMessage({ type: EXTENSION_MESSAGE_TYPES.GET_FEED }, (response) => {
    if (
      !isCurrentInstance()
      || !extensionEnabled
      || requestGeneration !== feedRequestGeneration
      || !response
      || !Array.isArray(response.feed)
    ) return;
    personalPicks = response.feed as RankedFeedItem[];
    renderRecommendationShelf();
  });
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

const applyRankedFeed = () => {
  if (!isCurrentInstance()) return;
  const feedById = new Map(cachedFeed.map((item) => [item.external_id, item]));
  const feedByTitle = new Map(cachedFeed.map((item) => [normalizeText(item.title ?? ''), item]));
  const knownElements = getVideoElements();

  knownElements.forEach((element) => {
    element.style.removeProperty('display');
    element.style.outline = '';
    element.style.outlineOffset = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;
    element.querySelector('[data-personal-algorithm-badge]')?.remove();

    const title = getVideoTitle(element);
    const item = feedById.get(getVideoId(element)) ?? feedByTitle.get(title);
    const decision = getNativeCardDecision(item, {
      sourceFiltered: shouldHideForSourceFilters(getVideoSourceFlags(element), sourceFilters),
      minimumVisibleScore: youtubeConnector.presentation.minimumVisibleScore,
    });

    if (decision.action === 'hide') {
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
    element.dataset.personalAlgorithmRank = String(cachedFeed.indexOf(item));
    element.style.outline = score >= 68 ? '2px solid rgba(20, 184, 166, 0.7)' : '';
    element.style.outlineOffset = score >= 68 ? '3px' : '';

    let badge = element.querySelector<HTMLElement>('[data-personal-algorithm-badge]');
    if (!badge) {
      badge = document.createElement('span');
      badge.dataset.personalAlgorithmBadge = 'true';
      badge.style.cssText = 'position:absolute;z-index:20;top:8px;left:8px;padding:4px 7px;border-radius:999px;background:#0f172a;color:#fff;font:600 11px/1.2 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);';
      if (!element.style.position) {
        element.style.position = 'relative';
        element.dataset.personalAlgorithmPositionPatched = 'true';
      }
      element.appendChild(badge);
    }
    badge.textContent = `${activeMode} · ${score}`;
  });
};
const scheduleRankGeneration = (generation: number) => {
  if (rankTimer !== undefined) window.clearTimeout(rankTimer);
  rankTimer = window.setTimeout(() => {
    rankTimer = undefined;
    if (!isCurrentInstance() || !extensionEnabled) return;
    if (rankingInFlight) {
      rankQueued = true;
      return;
    }
    void rankCurrentPage(generation);
  }, 180);
};

const scheduleLatestRank = () => {
  rankQueued = false;
  scheduleRankGeneration(rankGeneration);
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
  const result = await safeStorageGet(['personal-algorithm-mode']);
  if (!isCurrentInstance()) {
    rankingInFlight = false;
    return;
  }

  activeMode = (result['personal-algorithm-mode'] as string) ?? activeMode;
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
    rankingInFlight = false;
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
      cachedFeed = response.feed;
      lastCandidateSignature = candidateSignature;
      lastRankMode = requestMode;

      // A generation is rendered from a clean MyAlgo presentation surface.
      // This restores native cards first, then applies only this generation's
      // decisions without reordering YouTube-owned renderers.
      clearExtensionPresentation(false);
      applyRankedFeed();
      renderRecommendationShelf();

      const visibleCount = response.feed.filter((item: RankedFeedItem) => (
        item.visible !== false
        && item.suppressed !== true
        && (item.policyOutcome == null || item.policyOutcome === 'eligible')
        && (item.score ?? 0) >= youtubeConnector.presentation.minimumVisibleScore
      )).length;
      showStatus(`${requestMode}: ${visibleCount} scored visible · ${response.feed.length - visibleCount} scored hidden`);
    } else {
      console.warn('[MyAlgo] native feed ranking failed', { phase: 'rank-response' });
      showStatus(`Personal Algorithm: ${response?.error ?? 'ranking failed'}`, true);
    }
    if (rankQueued) scheduleLatestRank();
  });
};

const triggerRank = (
  reason: 'navigation' | 'mutation' | 'mode' | 'feedback' | 'graph' | 'manual' = 'manual',
) => {
  if (!isCurrentInstance() || !extensionEnabled || isYouTubeHistoryPage(location.pathname)) return;

  const currentCandidates = collectCandidates();
  const candidateSignature = currentCandidates.map((candidate) => candidate.external_id).sort().join('|');
  const hasMeaningfulCards = currentCandidates.length >= 2;

  // Only a native DOM mutation may reuse the current scored generation.
  // Mode, feedback, graph, and navigation changes must request fresh scores.
  if (
    reason === 'mutation'
    && hasMeaningfulCards
    && candidateSignature === lastCandidateSignature
    && activeMode === lastRankMode
    && cachedFeed.length > 0
  ) {
    applyRankedFeed();
    renderRecommendationShelf();
    return;
  }

  if (!hasMeaningfulCards && reason !== 'manual') return;

  const generation = ++rankGeneration;
  if (rankingInFlight) {
    rankQueued = true;
    return;
  }
  scheduleRankGeneration(generation);
};
const scheduleInitialRank = () => {
  if (!extensionEnabled || !isCurrentInstance() || isYouTubeHistoryPage(location.pathname)) return;
  window.setTimeout(() => {
    if (!extensionEnabled || !isCurrentInstance()) return;
    const currentCandidates = collectCandidates();
    if (currentCandidates.length > 0) {
      triggerRank('manual');
    }
  }, 1500);
};

safeStorageGet([
  STORAGE_KEYS.MODE,
  STORAGE_KEYS.ENABLED,
  STORAGE_KEYS.PRIVACY_DISCLOSURE_ACCEPTED_VERSION,
]).then((result) => {
  activeMode = (result[STORAGE_KEYS.MODE] as string) ?? activeMode;
  const disclosureAccepted = isPrivacyDisclosureAccepted(
    result[STORAGE_KEYS.PRIVACY_DISCLOSURE_ACCEPTED_VERSION],
  );
  extensionEnabled = disclosureAccepted
    && result[STORAGE_KEYS.ENABLED] !== false;
  if (!extensionEnabled) {
    clearExtensionPresentation(false);
    return;
  }
  showStatus(`Personal Algorithm: Active · ${activeMode}`, false, false);
  refreshRecommendationShelf();
  scheduleInitialRank();
});

safeStorageGet([STORAGE_KEYS.SOURCE_FILTERS]).then((result) => {
  sourceFilters = result[STORAGE_KEYS.SOURCE_FILTERS] as FeedSourceFilters | undefined ?? {};
});

const parseIsoDuration = (value: string | null): number | null => {
  if (!value) return null;
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return (Number(match[1] ?? 0) * 3600) + (Number(match[2] ?? 0) * 60) + Number(match[3] ?? 0);
};

const enrichYouTubeVideo = async (candidate: { external_id: string; title: string; channel_name?: string | null; thumbnail_url?: string | null; is_short?: boolean; is_live?: boolean }) => {
  const fallback = { ...candidate, enrichedAt: new Date().toISOString() };
  try {
    const url = youtubeConnector.getCanonicalUrl(candidate.external_id);
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return fallback;
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const meta = (selector: string) => doc.querySelector<HTMLMetaElement>(selector)?.content?.trim() || null;
    const title = meta('meta[property="og:title"]') ?? meta('meta[itemprop="name"]') ?? candidate.title;
    const description = meta('meta[name="description"]') ?? meta('meta[property="og:description"]');
    const thumbnail = meta('meta[property="og:image"]') ?? candidate.thumbnail_url ?? null;
    const duration = parseIsoDuration(meta('meta[itemprop="duration"]'));
    const publishedAt = meta('meta[itemprop="datePublished"]') ?? meta('meta[itemprop="uploadDate"]');
    const viewCountRaw = meta('meta[itemprop="interactionCount"]');
    const viewCount = viewCountRaw && /^\d+$/.test(viewCountRaw) ? Number(viewCountRaw) : null;
    const channelId = meta('meta[itemprop="channelId"]');
    const channelName = meta('meta[itemprop="author"]') ?? meta('meta[itemprop="channelName"]') ?? candidate.channel_name ?? null;
    return {
      ...fallback,
      title,
      channel_name: channelName,
      channel_id: channelId,
      thumbnail_url: thumbnail,
      description: description?.slice(0, 600) ?? null,
      duration_seconds: duration,
      published_at: publishedAt,
      view_count: viewCount,
    };
  } catch {
    return fallback;
  }
};

const enrichYouTubeVideos = async (candidates: Array<{ external_id: string; title: string; channel_name?: string | null; thumbnail_url?: string | null; is_short?: boolean; is_live?: boolean }>) => {
  const results: unknown[] = [];
  for (let index = 0; index < candidates.length; index += 3) {
    const batch = candidates.slice(index, index + 3);
    results.push(...await Promise.all(batch.map(enrichYouTubeVideo)));
  }
  return results;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isCurrentInstance()) return;
  if (message?.type === 'ENRICH_YOUTUBE_VIDEOS') {
    const candidates = Array.isArray(message.payload?.candidates) ? message.payload.candidates : [];
    void enrichYouTubeVideos(candidates).then((videos) => sendResponse({ ok: true, videos }));
    return true;
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
        refreshRecommendationShelf();
        triggerRank('manual');
      });
    }
    return;
  }
  if (message?.type === 'SOURCE_FILTERS_CHANGED') {
    rankGeneration += 1;
    cachedFeed = [];
    lastCandidateSignature = '';
    lastRankMode = '';
    clearExtensionPresentation(false);
    void safeStorageGet([STORAGE_KEYS.SOURCE_FILTERS]).then((result) => {
      sourceFilters = result[STORAGE_KEYS.SOURCE_FILTERS] as FeedSourceFilters | undefined ?? {};
      refreshRecommendationShelf();
      triggerRank('mode');
    });
    return;
  }
  if (message?.type === 'PERSONAL_ALGORITHM_CHANGED') {
    rankGeneration += 1;
    cachedFeed = [];
    lastCandidateSignature = '';
    lastRankMode = '';
    clearExtensionPresentation(false);
    triggerRank('graph');
    return;
  }
  if (message?.type !== 'MODE_CHANGED' || typeof message.payload?.mode !== 'string') return;
  rankGeneration += 1;
  activeMode = message.payload.mode;
  cachedFeed = [];
  lastCandidateSignature = '';
  lastRankMode = '';
  clearExtensionPresentation(false);
  refreshRecommendationShelf();
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
  refreshRecommendationShelf();
  scheduleHomeRecommendationObservation();
  attachTemporalWatchObserver();
});
window.addEventListener('yt-navigate-start', () => {
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
    refreshRecommendationShelf();
    triggerRank('navigation');
    scheduleHomeRecommendationObservation();
  }
});
window.addEventListener('yt-page-data-updated', () => {
  triggerRank('navigation');
});
window.addEventListener('popstate', () => {
  if (!isYouTubeHistoryPage(location.pathname)) triggerRank('navigation');
  else scheduleHistoryObservation();
});
window.addEventListener('resize', () => {
  if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = undefined;
    renderRecommendationShelf();
  }, 120);
});

const pageObserver = new MutationObserver((records) => {
  const hasNativeVideoMutation = records.some((record) => Array.from(record.addedNodes).some((node) => {
    if (!(node instanceof Element)) return false;
    if (node.closest(MYALGO_INJECTED_SELECTOR)) return false;
    return node.matches(`${videoSelectors.join(',')}, ${videoLinkSelector}`)
      || Boolean(node.querySelector(`${videoSelectors.join(',')}, ${videoLinkSelector}`));
  }));

  if (hasNativeVideoMutation) triggerRank('mutation');
  if (isYouTubeHistoryPage(location.pathname)) scheduleHistoryObservation();
  if (isYouTubeHomePage(location.pathname)) scheduleHomeRecommendationObservation();
  attachTemporalWatchObserver();
});
pageObserver.observe(document.documentElement, { childList: true, subtree: true });

window.setInterval(() => {
  if (isWatchPage()) attachTemporalWatchObserver();
}, 1000);

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
