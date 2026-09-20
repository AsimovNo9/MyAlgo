import { extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText, videoLinkSelector } from './youtube-dom';
import { STORAGE_KEYS } from '../lib/storage';
import { EXTENSION_MESSAGE_TYPES } from '../lib/messaging';

const videoSelectors = [
  'ytd-rich-item-renderer',
  'ytd-rich-grid-media',
  'ytd-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-reel-item-renderer',
];

type RankedFeedItem = {
  title?: string;
  channel_name?: string | null;
  thumbnail_url?: string | null;
  visible?: boolean;
  score?: number;
  external_id?: string;
};

let cachedFeed: RankedFeedItem[] = [];
let personalPicks: RankedFeedItem[] = [];
let rankingInFlight = false;
let activeMode = 'Work';
let rankGeneration = 0;
let extensionEnabled = true;
let lastCandidateSignature = '';
let lastRankMode = '';
let includeShorts = true;
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
    status.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:min(320px,calc(100vw - 24px));padding:10px 14px;border-radius:14px;border:1px solid rgba(148,163,184,0.35);font:700 12px/1.3 sans-serif;letter-spacing:0.02em;box-shadow:0 10px 26px rgba(15,23,42,0.38);';
    document.body.appendChild(status);
  }

  const isError = error || (!paused && message.toLowerCase().includes('failed'));
  status.style.background = isError ? '#7f1d1d' : paused ? '#374151' : '#14532d';
  status.style.color = '#f8fafc';
  status.style.borderColor = isError ? 'rgba(248,113,113,0.7)' : paused ? 'rgba(148,163,184,0.7)' : 'rgba(52,211,153,0.7)';
  status.textContent = message;
};

const normalizeText = (value: string) => normalizeYouTubeText(value).toLowerCase();

const clearExtensionPresentation = () => {
  document.querySelector('[data-personal-algorithm-shelf]')?.remove();
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-replacement]').forEach((element) => element.remove());
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-score]').forEach((element) => {
    element.style.removeProperty('display');
    element.style.outline = '';
    element.style.outlineOffset = '';
    element.style.order = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;
    element.querySelector('[data-personal-algorithm-badge]')?.remove();
  });
  showStatus('Personal Algorithm: Paused', false, true);
};

const removeReplacementCards = () => {
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-replacement]').forEach((element) => element.remove());
};

const createReplacementCard = (item: RankedFeedItem): HTMLElement => {
  const card = document.createElement('div');
  card.dataset.personalAlgorithmReplacement = 'true';
  card.style.cssText = 'display:block;min-width:0;padding:8px;background:var(--yt-spec-base-background, #fff);';

  const link = document.createElement('a');
  link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(item.external_id ?? '')}`;
  link.style.cssText = 'display:block;color:var(--yt-spec-text-primary, #0f0f0f);text-decoration:none;';

  if (item.thumbnail_url) {
    const image = document.createElement('img');
    image.src = item.thumbnail_url;
    image.alt = '';
    image.loading = 'lazy';
    image.style.cssText = 'display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:#eee;';
    link.appendChild(image);
  }

  const title = document.createElement('div');
  title.textContent = item.title ?? 'Recommended video';
  title.style.cssText = 'margin-top:8px;font-size:14px;font-weight:600;line-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;';
  link.appendChild(title);

  const channel = document.createElement('div');
  channel.textContent = item.channel_name ?? `${activeMode} pick`;
  channel.style.cssText = 'margin-top:4px;color:var(--yt-spec-text-secondary, #606060);font-size:12px;line-height:18px;';
  link.appendChild(channel);
  card.appendChild(link);
  return card;
};

const renderRecommendationShelf = (attempt = 0) => {
  if (!isCurrentInstance() || !extensionEnabled) return;

  const feedContainer = document.querySelector<HTMLElement>(
    'ytd-rich-grid-renderer #contents, ytd-two-column-browse-results-renderer #primary #contents, #contents',
  );
  if (!feedContainer) {
    if (attempt < 10) window.setTimeout(() => renderRecommendationShelf(attempt + 1), 500);
    return;
  }

  const picks = personalPicks
    .filter((item) => item.visible !== false && (item.score ?? 0) >= 52 && item.external_id)
    .slice(0, 6);
  if (picks.length === 0) {
    document.querySelector('[data-personal-algorithm-shelf]')?.remove();
    return;
  }

  let shelf = document.querySelector<HTMLElement>('[data-personal-algorithm-shelf]');
  if (!shelf) {
    shelf = document.createElement('section');
    shelf.dataset.personalAlgorithmShelf = 'true';
    shelf.style.cssText = 'display:block;margin:16px 0 24px;padding:16px 0;border-top:1px solid var(--yt-spec-10-percent-layer, #e5e5e5);border-bottom:1px solid var(--yt-spec-10-percent-layer, #e5e5e5);font-family:Roboto,Arial,sans-serif;';
    feedContainer.prepend(shelf);
  }

  shelf.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = `${activeMode} picks for you`;
  heading.style.cssText = 'margin:0 16px 12px;font-size:20px;line-height:28px;color:var(--yt-spec-text-primary, #0f0f0f);';
  shelf.appendChild(heading);

  const cards = document.createElement('div');
  cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;padding:0 16px;';
  for (const item of picks) {
    const card = document.createElement('a');
    card.href = `https://www.youtube.com/watch?v=${encodeURIComponent(item.external_id ?? '')}`;
    card.style.cssText = 'display:block;min-width:0;color:var(--yt-spec-text-primary, #0f0f0f);text-decoration:none;';

    if (item.thumbnail_url) {
      const image = document.createElement('img');
      image.src = item.thumbnail_url;
      image.alt = '';
      image.loading = 'lazy';
      image.style.cssText = 'display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:#eee;';
      card.appendChild(image);
    }

    const title = document.createElement('div');
    title.textContent = item.title ?? 'Recommended video';
    title.style.cssText = 'margin-top:8px;font-size:14px;font-weight:600;line-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;';
    card.appendChild(title);

    const channel = document.createElement('div');
    channel.textContent = item.channel_name ?? `${activeMode} pick`;
    channel.style.cssText = 'margin-top:4px;color:var(--yt-spec-text-secondary, #606060);font-size:12px;line-height:18px;';
    card.appendChild(channel);
    cards.appendChild(card);
  }
  shelf.appendChild(cards);
};

const refreshRecommendationShelf = () => {
  chrome.runtime.sendMessage({ type: EXTENSION_MESSAGE_TYPES.GET_FEED }, (response) => {
    if (!isCurrentInstance() || !response || !Array.isArray(response.feed)) return;
    personalPicks = response.feed as RankedFeedItem[];
    renderRecommendationShelf();
    applyRankedFeed();
  });
};

const getVideoTitle = (element: HTMLElement) => {
  const titleNode = element.querySelector<HTMLElement>([
    '#video-title',
    '#video-title-link',
    'a#video-title-link',
    'yt-formatted-string#video-title',
    '.title a',
    'h3 a',
    'a[title][href*="/watch"]',
    'a[aria-label][href*="/watch"]',
    'a[title][href*="/shorts/"]',
    'a[aria-label][href*="/shorts/"]',
  ].join(','));

  const directTitle =
    titleNode?.getAttribute('title')
    ?? titleNode?.getAttribute('aria-label')
    ?? titleNode?.textContent
    ?? '';

  if (normalizeText(directTitle)) {
    return normalizeText(directTitle);
  }

  const linkedTitle = Array.from(element.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .map((link) => extractYouTubeLinkTitle({
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
    .map((link) => extractYouTubeVideoId(link.href))
    .find(Boolean);
  return videoId ?? `title:${getVideoTitle(element)}`;
};

const getVideoSourceFlags = (element: HTMLElement) => {
  const href = Array.from(element.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))[0]?.href ?? '';
  return {
    is_short: /\/shorts\//i.test(href),
    is_live: /\/live\//i.test(href),
  };
};

const sendActivity = (externalId: string, eventType: 'opened' | 'revisited') => {
  if (!externalId || externalId.startsWith('title:')) return;
  chrome.runtime.sendMessage({
    type: 'ACTIVITY',
    payload: { externalId, eventType },
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
  const seen = new Set<string>();
  const cardCandidates = getVideoElements()
    .map((element) => ({
      external_id: getVideoId(element),
      title: getVideoTitle(element),
      channel_name: getChannelName(element),
      ...getVideoSourceFlags(element),
    }))
    .filter((candidate) => candidate.title)
    .slice(0, 80);

  const anchorCandidates = Array.from(document.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .filter((link) => !link.closest('[data-personal-algorithm-shelf], [data-personal-algorithm-replacement]'))
    .map((link) => ({
      external_id: extractYouTubeVideoId(link.href) ?? '',
      title: normalizeText(extractYouTubeLinkTitle({
        title: link.getAttribute('title'),
        ariaLabel: link.getAttribute('aria-label'),
        textContent: link.textContent,
      })),
      channel_name: '',
      is_short: /\/shorts\//i.test(link.href),
      is_live: /\/live\//i.test(link.href),
    }))
    .filter((candidate) => candidate.external_id && candidate.title);

  const candidates = [...cardCandidates, ...anchorCandidates]
    .filter((candidate) => {
      if (!candidate.title || seen.has(candidate.external_id)) return false;
      seen.add(candidate.external_id);
      return true;
    })
    .slice(0, 80);

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

const applyRankedFeed = () => {
  if (!isCurrentInstance()) return;
  removeReplacementCards();
  const feedById = new Map(cachedFeed.map((item) => [item.external_id, item]));
  const feedByTitle = new Map(cachedFeed.map((item) => [normalizeText(item.title ?? ''), item]));
  const rankedElements: Array<{ element: HTMLElement; rank: number }> = [];
  const replacementTargets: HTMLElement[] = [];
  const knownElements = getVideoElements();

  knownElements.forEach((element) => {
    element.style.removeProperty('display');
    element.style.outline = '';
    element.style.outlineOffset = '';
    element.style.order = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;

    const title = getVideoTitle(element);
    const item = feedById.get(getVideoId(element)) ?? feedByTitle.get(title);
    const isShort = getVideoSourceFlags(element).is_short;
    if (isShort && includeShorts) {
      element.style.removeProperty('display');
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
    const shouldHide = item.visible === false || score < 52;
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
    element.style.order = String(rank);

    let badge = element.querySelector<HTMLElement>('[data-personal-algorithm-badge]');
    if (!badge) {
      badge = document.createElement('span');
      badge.dataset.personalAlgorithmBadge = 'true';
      badge.style.cssText = 'position:absolute;z-index:20;top:8px;left:8px;padding:4px 7px;border-radius:999px;background:#0f172a;color:#fff;font:600 11px/1.2 sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);';
      element.style.position = 'relative';
      element.appendChild(badge);
    }
    badge.textContent = `${activeMode} · ${score}`;
    rankedElements.push({ element, rank });
  });

  const elementsByParent = new Map<HTMLElement, Array<{ element: HTMLElement; rank: number }>>();
  for (const rankedElement of rankedElements) {
    const parent = rankedElement.element.parentElement;
    if (!parent) continue;
    const group = elementsByParent.get(parent) ?? [];
    group.push(rankedElement);
    elementsByParent.set(parent, group);
  }

  for (const [parent, group] of elementsByParent) {
    if (group.length < 2) continue;
    group.sort((left, right) => left.rank - right.rank);
    for (const { element } of group) {
      parent.appendChild(element);
    }
  }
};

const rankCurrentPage = async () => {
  if (!isCurrentInstance() || !extensionEnabled || rankingInFlight) return;
  const candidates = collectCandidates();
  if (candidates.length === 0) {
    showStatus(`Personal Algorithm: no cards on ${location.hostname}`, true);
    return;
  }

  rankingInFlight = true;
  showStatus(`Personal Algorithm: ranking ${candidates.length} videos`);
  const result = await chrome.storage.local.get(['personal-algorithm-mode']);
  if (!isCurrentInstance()) return;
  activeMode = (result['personal-algorithm-mode'] as string) ?? activeMode;
  const candidateSignature = candidates.map((candidate) => candidate.external_id).sort().join('|');
  if (candidateSignature === lastCandidateSignature && activeMode === lastRankMode && cachedFeed.length > 0) {
    rankingInFlight = false;
    return;
  }
  const requestGeneration = rankGeneration;
  const requestMode = activeMode;
  chrome.runtime.sendMessage({ type: 'RANK_PAGE', payload: { mode: requestMode, candidates } }, (response) => {
    rankingInFlight = false;
    if (!isCurrentInstance() || requestGeneration !== rankGeneration) {
      if (isCurrentInstance()) triggerRank('manual');
      return;
    }
    if (response?.ok && Array.isArray(response.feed)) {
      cachedFeed = response.feed;
      lastCandidateSignature = candidateSignature;
      lastRankMode = requestMode;
      applyRankedFeed();
      renderRecommendationShelf();
      const visibleCount = response.feed.filter((item: RankedFeedItem) => item.visible !== false && (item.score ?? 0) >= 52).length;
      showStatus(`${requestMode}: ${visibleCount} shown · ${response.feed.length - visibleCount} hidden`);
    } else {
      showStatus(`Personal Algorithm: ${response?.error ?? 'ranking failed'}`, true);
    }
  });

  const existingIds = new Set(cachedFeed.map((item) => item.external_id).filter(Boolean));
  const replacements = personalPicks
    .filter((item) => item.visible !== false && (item.score ?? 0) >= 52 && item.external_id && !existingIds.has(item.external_id))
    .slice(0, replacementTargets.length);
  replacementTargets.forEach((target, index) => {
    const replacement = replacements[index];
    if (replacement) target.parentElement?.insertBefore(createReplacementCard(replacement), target);
  });
};

const triggerRank = (reason: 'navigation' | 'mode' | 'manual' = 'manual') => {
  if (!isCurrentInstance() || !extensionEnabled || rankingInFlight) return;

  const currentCandidates = collectCandidates();
  const candidateSignature = currentCandidates.map((candidate) => candidate.external_id).sort().join('|');
  const hasMeaningfulCards = currentCandidates.length >= 2;
  if (reason !== 'manual' && hasMeaningfulCards && candidateSignature === lastCandidateSignature && activeMode === lastRankMode && cachedFeed.length > 0) {
    return;
  }

  if (!hasMeaningfulCards && reason !== 'manual') {
    return;
  }

  void rankCurrentPage();
};

const scheduleInitialRank = () => {
  if (!extensionEnabled || !isCurrentInstance()) return;
  window.setTimeout(() => {
    if (!extensionEnabled || !isCurrentInstance()) return;
    const currentCandidates = collectCandidates();
    if (currentCandidates.length > 0) {
      void rankCurrentPage();
    }
  }, 1500);
};

chrome.storage.local.get([STORAGE_KEYS.ENABLED]).then((result) => {
  extensionEnabled = result[STORAGE_KEYS.ENABLED] !== false;
  if (!extensionEnabled) {
    clearExtensionPresentation();
    return;
    refreshRecommendationShelf();
  }
  showStatus(`Personal Algorithm: Active · ${activeMode}`, false, false);
  scheduleInitialRank();
});

chrome.storage.local.get([STORAGE_KEYS.SOURCE_FILTERS]).then((result) => {
  const filters = result[STORAGE_KEYS.SOURCE_FILTERS] as { includeShorts?: boolean } | undefined;
  includeShorts = filters?.includeShorts !== false;
});

chrome.runtime.onMessage.addListener((message) => {
  if (!isCurrentInstance()) return;
  if (message?.type === 'EXTENSION_ENABLED' && typeof message.payload?.enabled === 'boolean') {
    extensionEnabled = message.payload.enabled;
    rankGeneration += 1;
    rankingInFlight = false;
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
    rankingInFlight = false;
    cachedFeed = [];
    lastCandidateSignature = '';
    lastRankMode = '';
    void chrome.storage.local.get([STORAGE_KEYS.SOURCE_FILTERS]).then((result) => {
      const filters = result[STORAGE_KEYS.SOURCE_FILTERS] as { includeShorts?: boolean } | undefined;
      includeShorts = filters?.includeShorts !== false;
      refreshRecommendationShelf();
      triggerRank('mode');
    });
    return;
  }
  if (message?.type !== 'MODE_CHANGED' || typeof message.payload?.mode !== 'string') return;
  rankGeneration += 1;
  rankingInFlight = false;
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
});
window.addEventListener('yt-navigate-finish', () => {
  const currentVideoId = extractYouTubeVideoId(window.location.href);
  if (currentVideoId) sendActivity(currentVideoId, 'revisited');
  triggerRank('navigation');
});
window.addEventListener('yt-page-data-updated', () => {
  triggerRank('navigation');
});
window.addEventListener('popstate', () => {
  triggerRank('navigation');
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(videoLinkSelector) : null;
  const videoId = target ? extractYouTubeVideoId(target.href) : undefined;
  if (videoId) sendActivity(videoId, 'opened');
}, true);
