import { STORAGE_KEYS } from '../lib/storage';
import { EXTENSION_MESSAGE_TYPES } from '../lib/messaging';
import { dedupeCandidatesById, getReplacementCandidates, getShelfCandidates, isRenderGenerationStale, shouldHideForSourceFilters } from './youtube-ux';
import type { RankedFeedItem } from './youtube-ux';
import { youtubeConnector } from '../connectors/youtube';
import type { FeedSourceFilters } from '@repo/shared-types';
import { collectHistoryEvidenceFromDom, isYouTubeHistoryPage } from './youtube-history';
import { collectRecommendationObservationsFromDom, isYouTubeHomePage } from './youtube-recommendations';

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
let extensionEnabled = true;
let lastCandidateSignature = '';
let lastRankMode = '';
let sourceFilters: FeedSourceFilters = {};
const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const instanceAttribute = 'data-personal-algorithm-instance';
document.documentElement.setAttribute(instanceAttribute, instanceId);

const isCurrentInstance = () => document.documentElement.getAttribute(instanceAttribute) === instanceId;

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
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-replacement]').forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-score]').forEach((element) => {
    element.style.removeProperty('display');
    element.style.outline = '';
    element.style.outlineOffset = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;
    element.querySelector('[data-personal-algorithm-badge]')?.remove();
  });
  if (showPaused) {
    showStatus('Personal Algorithm: Paused', false, true);
  } else {
    document.querySelector('[data-personal-algorithm-status]')?.remove();
  }
};

const removeReplacementCards = () => {
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-replacement]').forEach((element) => element.remove());
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

const createReplacementCard = (item: RankedFeedItem, target: HTMLElement): HTMLElement => {
  const card = document.createElement(target.localName);
  card.className = target.className;
  card.dataset.personalAlgorithmReplacement = 'true';
  card.dataset.personalAlgorithmVideoId = item.external_id ?? '';
  card.style.cssText = 'display:block;min-width:0;align-self:start;box-sizing:border-box;background:var(--yt-spec-base-background, #fff);';

  const link = document.createElement('a');
  link.href = youtubeConnector.getCanonicalUrl(item.external_id ?? '');
  link.style.cssText = 'display:block;color:var(--yt-spec-text-primary, #0f0f0f);text-decoration:none;';

  link.appendChild(createThumbnail(item));

  const title = document.createElement('div');
  title.textContent = item.title ?? 'Recommended video';
  title.style.cssText = 'margin-top:8px;font-size:14px;font-weight:600;line-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;';
  link.appendChild(title);

  const channel = document.createElement('div');
  channel.textContent = item.channel_name ?? `${activeMode} pick`;
  channel.style.cssText = 'margin-top:4px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--yt-spec-text-secondary, #606060);font-size:12px;line-height:18px;';
  link.appendChild(channel);
  card.appendChild(link);
  return card;
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
  const requestGeneration = ++feedRequestGeneration;
  chrome.runtime.sendMessage({ type: EXTENSION_MESSAGE_TYPES.GET_FEED }, (response) => {
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
  if (!externalId || externalId.startsWith('title:')) return;
  chrome.runtime.sendMessage({
    type: 'ACTIVITY',
    payload: { externalId, eventType: youtubeConnector.mapPresentationEvent(eventType) },
  });
};

const getCardForVideoLink = (link: HTMLAnchorElement) => {
  if (link.closest('[data-personal-algorithm-shelf], [data-personal-algorithm-replacement]')) return null;
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

const getVideoElements = () => {
  const knownElements = Array.from(document.querySelectorAll(videoSelectors.join(','))) as HTMLElement[];
  const linkElements = Array.from(document.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .map(getCardForVideoLink)
    .filter((element): element is HTMLElement => Boolean(element));
  return Array.from(new Set([...knownElements, ...linkElements]));
};

const collectCandidates = () => {
  const cardCandidates = getVideoElements()
    .map((element) => ({
      external_id: getVideoId(element),
      title: getVideoTitle(element),
      channel_name: getChannelName(element),
      thumbnail_url: element.querySelector<HTMLImageElement>('img[src]')?.src ?? null,
      ...getVideoSourceFlags(element),
    }))
    .filter((candidate) => candidate.title)
    .slice(0, youtubeConnector.presentation.candidateLimit);

  const anchorCandidates = Array.from(document.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .filter((link) => !link.closest('[data-personal-algorithm-shelf], [data-personal-algorithm-replacement]'))
    .map((link) => ({
      external_id: youtubeConnector.getExternalId(link.href) ?? '',
      title: normalizeText(youtubeConnector.getLinkTitle({
        title: link.getAttribute('title'),
        ariaLabel: link.getAttribute('aria-label'),
        textContent: link.textContent,
      })),
      channel_name: '',
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
  if (!isCurrentInstance() || !isYouTubeHistoryPage(location.pathname)) return;

  chrome.storage.local.get([STORAGE_KEYS.HISTORY_OBSERVATION_ENABLED], (result) => {
    if (result[STORAGE_KEYS.HISTORY_OBSERVATION_ENABLED] !== true) return;
    const observation = collectHistoryEvidenceFromDom(document);
    if (observation.evidence.length === 0) return;
    chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGE_TYPES.HISTORY_OBSERVATION,
      payload: observation,
    });
  });
};

const observeHistoryPage = () => {
  if (
    !isCurrentInstance()
    || !isYouTubeHistoryPage(location.pathname)
    || historyScanInFlight
  ) {
    return;
  }

  chrome.storage.local.get([STORAGE_KEYS.HISTORY_OBSERVATION_ENABLED], (result) => {
    if (result[STORAGE_KEYS.HISTORY_OBSERVATION_ENABLED] !== true) return;

    historyScanInFlight = true;

    void scanYouTubeHistory(document, {
      maxBatches: 100,
      stableRounds: 4,
      delayMs: 800,
      onBatch: async (observation) => {
        await new Promise<void>((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: EXTENSION_MESSAGE_TYPES.HISTORY_OBSERVATION,
              payload: observation,
            },
            () => resolve(),
          );
        });
      },
    }).finally(() => {
      historyScanInFlight = false;
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
  if (!isCurrentInstance() || !isYouTubeHomePage(location.pathname)) return;
  chrome.storage.local.get([STORAGE_KEYS.HOME_OBSERVATION_ENABLED], (result) => {
    if (result[STORAGE_KEYS.HOME_OBSERVATION_ENABLED] !== true) return;
    const observation = collectRecommendationObservationsFromDom(document);
    chrome.runtime.sendMessage({
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
  removeReplacementCards();
  const feedById = new Map(cachedFeed.map((item) => [item.external_id, item]));
  const feedByTitle = new Map(cachedFeed.map((item) => [normalizeText(item.title ?? ''), item]));
  const replacementTargets: HTMLElement[] = [];
  const knownElements = getVideoElements();

  knownElements.forEach((element) => {
    element.style.removeProperty('display');
    element.style.outline = '';
    element.style.outlineOffset = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;

    const title = getVideoTitle(element);
    const item = feedById.get(getVideoId(element)) ?? feedByTitle.get(title);
    if (shouldHideForSourceFilters(getVideoSourceFlags(element), sourceFilters)) {
      element.style.setProperty('display', 'none', 'important');
      element.dataset.personalAlgorithmScore = 'source-filtered';
      element.querySelector('[data-personal-algorithm-badge]')?.remove();
      return;
    }
    if (!item) {
      element.style.setProperty('display', 'none', 'important');
      element.dataset.personalAlgorithmScore = 'unmatched';
      element.querySelector('[data-personal-algorithm-badge]')?.remove();
      replacementTargets.push(element);
      return;
    }

    const score = item.score ?? 0;
    const shouldHide = item.visible === false || score < youtubeConnector.presentation.minimumVisibleScore;
    if (shouldHide) {
      element.style.setProperty('display', 'none', 'important');
      replacementTargets.push(element);
    } else {
      element.style.removeProperty('display');
    }
    element.style.outline = score >= 68 ? '2px solid rgba(20, 184, 166, 0.7)' : '';
    element.style.outlineOffset = score >= 68 ? '3px' : '';
    element.dataset.personalAlgorithmScore = String(score);
    const rank = cachedFeed.indexOf(item);
    element.dataset.personalAlgorithmRank = String(rank);

    let badge = element.querySelector<HTMLElement>('[data-personal-algorithm-badge]');
    if (!badge) {
      badge = document.createElement('span');
      badge.dataset.personalAlgorithmBadge = 'true';
      badge.style.cssText = 'position:absolute;z-index:20;top:8px;left:8px;padding:4px 7px;border-radius:999px;background:#0f172a;color:#fff;font:600 11px/1.2 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);';
      element.style.position = 'relative';
      element.appendChild(badge);
    }
    badge.textContent = `${activeMode} · ${score}`;
  });

  const blockedIds = new Set(getVideoElements().map(getVideoId));
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-video-id]').forEach((element) => {
    blockedIds.add(element.dataset.personalAlgorithmVideoId ?? '');
  });
  const replacements = getReplacementCandidates(
    personalPicks,
    blockedIds,
    replacementTargets.length,
    youtubeConnector.presentation.minimumVisibleScore,
  );
  replacementTargets.forEach((target, index) => {
    const replacement = replacements[index];
    if (replacement) target.parentElement?.insertBefore(createReplacementCard(replacement, target), target);
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
  if (!isCurrentInstance() || !extensionEnabled) return;
  if (rankingInFlight) {
    rankQueued = true;
    return;
  }
  const candidates = collectCandidates();
  if (candidates.length === 0) {
    showStatus(`Personal Algorithm: no cards on ${location.hostname}`, true);
    return;
  }

  rankingInFlight = true;
  showStatus(`Personal Algorithm: ranking ${candidates.length} videos`);
  const result = await chrome.storage.local.get(['personal-algorithm-mode']);
  if (!isCurrentInstance()) {
    rankingInFlight = false;
    return;
  }
  activeMode = (result['personal-algorithm-mode'] as string) ?? activeMode;
  if (isRenderGenerationStale(requestGeneration, rankGeneration)) {
    rankingInFlight = false;
    scheduleLatestRank();
    return;
  }
  const candidateSignature = candidates.map((candidate) => candidate.external_id).sort().join('|');
  if (candidateSignature === lastCandidateSignature && activeMode === lastRankMode && cachedFeed.length > 0) {
    rankingInFlight = false;
    if (rankQueued) scheduleLatestRank();
    return;
  }
  const requestMode = activeMode;
  chrome.runtime.sendMessage({ type: 'RANK_PAGE', payload: { mode: requestMode, candidates } }, (response) => {
    rankingInFlight = false;
    if (!isCurrentInstance() || isRenderGenerationStale(requestGeneration, rankGeneration)) {
      if (isCurrentInstance() && extensionEnabled) scheduleLatestRank();
      return;
    }
    if (response?.ok && Array.isArray(response.feed)) {
      cachedFeed = response.feed;
      lastCandidateSignature = candidateSignature;
      lastRankMode = requestMode;
      renderRecommendationShelf();
      applyRankedFeed();
      const visibleCount = response.feed.filter((item: RankedFeedItem) => (
        item.visible !== false && (item.score ?? 0) >= youtubeConnector.presentation.minimumVisibleScore
      )).length;
      showStatus(`${requestMode}: ${visibleCount} shown · ${response.feed.length - visibleCount} hidden`);
    } else {
      showStatus(`Personal Algorithm: ${response?.error ?? 'ranking failed'}`, true);
    }
    if (rankQueued) scheduleLatestRank();
  });
};

const triggerRank = (reason: 'navigation' | 'mutation' | 'mode' | 'manual' = 'manual') => {
  if (!isCurrentInstance() || !extensionEnabled) return;

  const currentCandidates = collectCandidates();
  const candidateSignature = currentCandidates.map((candidate) => candidate.external_id).sort().join('|');
  const hasMeaningfulCards = currentCandidates.length >= 2;
  if (reason !== 'manual' && hasMeaningfulCards && candidateSignature === lastCandidateSignature && activeMode === lastRankMode && cachedFeed.length > 0) {
    renderRecommendationShelf();
    applyRankedFeed();
    return;
  }

  if (!hasMeaningfulCards && reason !== 'manual') {
    return;
  }

  const generation = ++rankGeneration;
  if (rankingInFlight) {
    rankQueued = true;
    return;
  }
  scheduleRankGeneration(generation);
};

const scheduleInitialRank = () => {
  if (!extensionEnabled || !isCurrentInstance()) return;
  window.setTimeout(() => {
    if (!extensionEnabled || !isCurrentInstance()) return;
    const currentCandidates = collectCandidates();
    if (currentCandidates.length > 0) {
      triggerRank('manual');
    }
  }, 1500);
};

chrome.storage.local.get([STORAGE_KEYS.ENABLED]).then((result) => {
  extensionEnabled = result[STORAGE_KEYS.ENABLED] !== false;
  if (!extensionEnabled) {
    clearExtensionPresentation();
    return;
  }
  showStatus(`Personal Algorithm: Active · ${activeMode}`, false, false);
  refreshRecommendationShelf();
  scheduleInitialRank();
});

chrome.storage.local.get([STORAGE_KEYS.SOURCE_FILTERS]).then((result) => {
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
    if (extensionEnabled) {
      showStatus(`Personal Algorithm: Active · ${activeMode}`, false, false);
      refreshRecommendationShelf();
      triggerRank('mode');
    } else {
      clearExtensionPresentation();
    }
    return;
  }
  if (message?.type === 'SOURCE_FILTERS_CHANGED') {
    rankGeneration += 1;
    cachedFeed = [];
    lastCandidateSignature = '';
    lastRankMode = '';
    void chrome.storage.local.get([STORAGE_KEYS.SOURCE_FILTERS]).then((result) => {
      sourceFilters = result[STORAGE_KEYS.SOURCE_FILTERS] as FeedSourceFilters | undefined ?? {};
      refreshRecommendationShelf();
      triggerRank('mode');
    });
    return;
  }
  if (message?.type !== 'MODE_CHANGED' || typeof message.payload?.mode !== 'string') return;
  rankGeneration += 1;
  activeMode = message.payload.mode;
  cachedFeed = [];
  refreshRecommendationShelf();
  triggerRank('mode');
});

const registerFeedbackHandlers = () => {
  const buttons = Array.from(document.querySelectorAll('button, ytd-menu-service-item-renderer')) as HTMLElement[];

  buttons.forEach((button) => {
    const label = button.textContent?.toLowerCase() ?? '';
    if (!label.includes('not interested') && !label.includes('more like this') && !label.includes('never show')) return;

    button.addEventListener('click', () => {
      const card = button.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer') as HTMLElement | null;
      const contentItemId = card ? getVideoId(card) : '';
      const eventType = label.includes('more like this') ? 'more_like_this' : label.includes('never show') ? 'never_show_channel' : 'not_interested';

      chrome.runtime.sendMessage({
        type: 'FEEDBACK',
        payload: { contentItemId, eventType },
      });
    }, { once: true });
  });
};

registerFeedbackHandlers();

window.addEventListener('load', () => {
  scheduleInitialRank();
  refreshRecommendationShelf();
  scheduleHomeRecommendationObservation();
});
window.addEventListener('yt-navigate-start', () => {
  rankGeneration += 1;
  cachedFeed = [];
  lastCandidateSignature = '';
  lastRankMode = '';
  clearExtensionPresentation(false);
});
window.addEventListener('yt-navigate-finish', () => {
  const currentVideoId = youtubeConnector.getExternalId(window.location.href);
  if (currentVideoId) sendActivity(currentVideoId, 'revisited');
  refreshRecommendationShelf();
  triggerRank('navigation');
  scheduleHistoryObservation();
  scheduleHomeRecommendationObservation();
});
window.addEventListener('yt-page-data-updated', () => {
  triggerRank('navigation');
});
window.addEventListener('popstate', () => {
  triggerRank('navigation');
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
    if (node.closest('[data-personal-algorithm-shelf], [data-personal-algorithm-replacement]')) return false;
    return node.matches(`${videoSelectors.join(',')}, ${videoLinkSelector}`)
      || Boolean(node.querySelector(`${videoSelectors.join(',')}, ${videoLinkSelector}`));
  }));

  if (hasNativeVideoMutation) triggerRank('mutation');
  if (isYouTubeHistoryPage(location.pathname)) scheduleHistoryObservation();
  if (isYouTubeHomePage(location.pathname)) scheduleHomeRecommendationObservation();
});
pageObserver.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(videoLinkSelector) : null;
  const videoId = target ? youtubeConnector.getExternalId(target.href) : undefined;
  if (videoId) sendActivity(videoId, 'opened');
}, true);

scheduleHistoryObservation();
scheduleHomeRecommendationObservation();
