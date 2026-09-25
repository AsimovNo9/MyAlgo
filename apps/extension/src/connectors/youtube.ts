import { extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText, videoLinkSelector } from '../content-scripts/youtube-dom.ts';
import type { PageProviderConnector } from './types';

export const youtubeConnector = {
  id: 'youtube',
  capabilities: {
    search: true,
    activity: true,
    subscriptions: true,
    writeActions: false,
    publicContent: true,
    userContent: true,
  },
  pageUrlPatterns: ['https://www.youtube.com/*', 'https://youtube.com/*'],
  cardSelectors: [
    'ytd-rich-item-renderer',
    'ytd-rich-grid-media',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-reel-item-renderer',
    'yt-lockup-view-model',
  ],
  titleSelectors: [
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
  ],
  videoLinkSelector,
  presentation: {
    candidateLimit: 1000,
    minimumVisibleScore: 52,
    shelfBatchSize: 6,
    shelfDomLimit: 18,
    horizontalAspectRatio: '16 / 9',
    verticalAspectRatio: '9 / 16',
  },
  canHandleUrl(href) {
    try {
      const hostname = new URL(href, 'https://www.youtube.com').hostname.toLowerCase();
      return hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';
    } catch {
      return false;
    }
  },
  getExternalId: extractYouTubeVideoId,
  getCanonicalUrl(externalId) {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(externalId)}`;
  },
  getSourceFlags(href) {
    return {
      is_short: /\/shorts\//i.test(href),
      is_live: /\/live\//i.test(href),
    };
  },
  normalizeText: normalizeYouTubeText,
  getLinkTitle: extractYouTubeLinkTitle,
  mapPresentationEvent(event) {
    return event;
  },
} satisfies PageProviderConnector;
