import { extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText, videoLinkSelector } from './youtube-dom';
import { STORAGE_KEYS } from '../lib/storage';

const videoSelectors = [
  'ytd-rich-item-renderer',
  'ytd-rich-grid-media',
  'ytd-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-reel-item-renderer',
  'ytd-rich-section-renderer',
];

type RankedFeedItem = {
  title?: string;
  visible?: boolean;
  score?: number;
  external_id?: string;
};

let cachedFeed: RankedFeedItem[] = [];
let rankTimer: number | null = null;
let rankingInFlight = false;
let activeMode = 'Work';
let observer: MutationObserver | null = null;
let rankGeneration = 0;
let extensionEnabled = true;
let lastCandidateSignature = '';
let lastRankMode = '';
const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const instanceAttribute = 'data-personal-algorithm-instance';
document.documentElement.setAttribute(instanceAttribute, instanceId);

const isCurrentInstance = () => document.documentElement.getAttribute(instanceAttribute) === instanceId;

const showStatus = (message: string, error = false) => {
  if (!isCurrentInstance()) return;
  let status = document.querySelector<HTMLElement>('[data-personal-algorithm-status]');
  if (!status) {
    status = document.createElement('div');
    status.dataset.personalAlgorithmStatus = 'true';
    status.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:8px 11px;border-radius:999px;background:#0f172a;color:#fff;font:600 12px/1.2 sans-serif;box-shadow:0 3px 14px rgba(0,0,0,.3);';
    document.body.appendChild(status);
  }
  status.style.background = error ? '#991b1b' : '#0f172a';
  status.textContent = message;
};

const normalizeText = (value: string) => normalizeYouTubeText(value).toLowerCase();

const clearExtensionPresentation = () => {
  observer?.disconnect();
  document.querySelectorAll<HTMLElement>('[data-personal-algorithm-score]').forEach((element) => {
    element.style.display = '';
    element.style.outline = '';
    element.style.outlineOffset = '';
    element.style.order = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;
    element.querySelector('[data-personal-algorithm-badge]')?.remove();
  });
  document.querySelector('[data-personal-algorithm-status]')?.remove();
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
  const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('a#thumbnail[href], a#video-title-link[href], a[href*="/watch"], a[href*="/shorts/"]'));
  const videoId = links
    .map((link) => extractYouTubeVideoId(link.href))
    .find(Boolean);
  return videoId ?? `title:${getVideoTitle(element)}`;
};

const getCardForVideoLink = (link: HTMLAnchorElement) => {
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
    }))
    .filter((candidate) => candidate.title)
    .slice(0, 80);

  const anchorCandidates = Array.from(document.querySelectorAll<HTMLAnchorElement>(videoLinkSelector))
    .map((link) => ({
      external_id: extractYouTubeVideoId(link.href) ?? '',
      title: normalizeText(extractYouTubeLinkTitle({
        title: link.getAttribute('title'),
        ariaLabel: link.getAttribute('aria-label'),
        textContent: link.textContent,
      })),
      channel_name: '',
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
  observer?.disconnect();
  const feedById = new Map(cachedFeed.map((item) => [item.external_id, item]));
  const feedByTitle = new Map(cachedFeed.map((item) => [normalizeText(item.title ?? ''), item]));
  const rankedElements: Array<{ element: HTMLElement; rank: number }> = [];
  const knownElements = getVideoElements();

  knownElements.forEach((element) => {
    element.style.display = '';
    element.style.outline = '';
    element.style.outlineOffset = '';
    element.style.order = '';
    delete element.dataset.personalAlgorithmScore;
    delete element.dataset.personalAlgorithmRank;

    const title = getVideoTitle(element);
    const item = feedById.get(getVideoId(element)) ?? feedByTitle.get(title);
    if (!item) {
      element.querySelector('[data-personal-algorithm-badge]')?.remove();
      return;
    }

    const score = item.score ?? 0;
    const shouldHide = item.visible === false || score < 52;
    element.style.display = shouldHide ? 'none' : '';
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

  observer?.observe(document.body, { childList: true, subtree: true });
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
      if (isCurrentInstance()) scheduleRank();
      return;
    }
    if (response?.ok && Array.isArray(response.feed)) {
      cachedFeed = response.feed;
      lastCandidateSignature = candidateSignature;
      lastRankMode = requestMode;
      applyRankedFeed();
      showStatus(`${requestMode}: ranked ${response.feed.length} videos`);
    } else {
      showStatus(`Personal Algorithm: ${response?.error ?? 'ranking failed'}`, true);
    }
  });
};

const scheduleRank = () => {
  if (!isCurrentInstance()) return;
  if (rankTimer !== null) window.clearTimeout(rankTimer);
  rankTimer = window.setTimeout(() => {
    rankTimer = null;
    rankCurrentPage();
  }, 650);
};

observer = new MutationObserver(scheduleRank);
chrome.storage.local.get([STORAGE_KEYS.ENABLED]).then((result) => {
  extensionEnabled = result[STORAGE_KEYS.ENABLED] !== false;
  if (!extensionEnabled) {
    clearExtensionPresentation();
    return;
  }
  observer?.observe(document.body, { childList: true, subtree: true });
  rankCurrentPage();
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
      observer?.observe(document.body, { childList: true, subtree: true });
      scheduleRank();
    } else {
      clearExtensionPresentation();
    }
    return;
  }
  if (message?.type !== 'MODE_CHANGED' || typeof message.payload?.mode !== 'string') return;
  rankGeneration += 1;
  rankingInFlight = false;
  activeMode = message.payload.mode;
  cachedFeed = [];
  scheduleRank();
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

window.addEventListener('yt-navigate-finish', scheduleRank);
window.addEventListener('popstate', scheduleRank);
