import { extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText, videoLinkSelector } from '../content-scripts/youtube-dom.ts';
import type { PageProviderConnector } from './types';

const createYouTubeContentIdentity = (externalId: string) => ({
  source: 'youtube',
  externalId,
});

export const youtubeConnector: PageProviderConnector = {
  source: 'youtube',
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
    minimumVisibleScore: 0,
    replacementMinimumScore: 1,
    replacementLimit: 6,
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
  identifyContent(externalId) {
    return createYouTubeContentIdentity(externalId);
  },
  normalizeMetadata(input) {
    return {
      title: normalizeYouTubeText(input.title ?? ''),
      creatorId: normalizeYouTubeText(input.creatorId ?? '') || null,
      creatorName: normalizeYouTubeText(input.creatorName ?? '') || null,
      description: normalizeYouTubeText(input.description ?? '') || null,
      durationSeconds: Number.isFinite(input.durationSeconds)
        ? Math.max(0, Number(input.durationSeconds))
        : null,
      publishedAt: input.publishedAt ?? null,
      language: normalizeYouTubeText(input.language ?? '') || null,
      format: normalizeYouTubeText(input.format ?? '') || null,
      contentType: normalizeYouTubeText(input.contentType ?? '') || null,
    };
  },
  createExposure(input) {
    return {
      kind: 'exposure',
      exposureId: input.exposureId,
      content: createYouTubeContentIdentity(input.externalId),
      surface: input.surface,
      section: input.section ?? null,
      position: input.position ?? null,
      observedAt: input.observedAt,
      provenance: {
        connector: 'youtube',
        mechanism: input.mechanism,
      },
      metadata: input.metadata ?? null,
    };
  },
  createInteraction(input) {
    return {
      kind: 'interaction',
      content: this.identifyContent(input.externalId),
      exposureId: input.exposureId ?? null,
      interaction: input.interaction,
      observedAt: input.observedAt,
      provenance: {
        connector: 'youtube',
        mechanism: input.mechanism,
      },
      sessionId: input.sessionId ?? null,
      metrics: input.metrics,
      metadata: input.metadata ?? null,
    };
  },
} satisfies PageProviderConnector;
