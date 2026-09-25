import { extractYouTubeCreator, extractYouTubeLinkTitle, extractYouTubeShortsTitle, extractYouTubeVideoId, normalizeYouTubeText, videoLinkSelector } from './youtube-dom.ts';
import { createExposureId } from './youtube-interactions.ts';

export type RecommendationObservation = {
  externalId: string;
  exposureId: string;
  title: string;
  creator: string | null;
  position: number;
  section: string | null;
  observedAt: string;
  provenance: 'youtube_home_dom';
  evidenceKind: 'surfaced';
  outcome: 'unobserved' | 'clicked' | 'watched';
};

export type RecommendationObservationCandidate = {
  href: string;
  title?: string | null;
  creator?: string | null;
  section?: string | null;
  injected?: boolean;
};

export type RecommendationObservationMetrics = {
  observedCandidates: number;
  usableObservations: number;
  duplicateCandidates: number;
  missingVideoId: number;
  missingTitle: number;
  injectedCandidates: number;
};

export function isYouTubeHomePage(pathname: string): boolean {
  return pathname === '/' || pathname === '';
}

export function collectRecommendationObservations(
  candidates: RecommendationObservationCandidate[],
  observedAt = new Date().toISOString(),
): { observations: RecommendationObservation[]; metrics: RecommendationObservationMetrics } {
  const metrics: RecommendationObservationMetrics = {
    observedCandidates: candidates.length,
    usableObservations: 0,
    duplicateCandidates: 0,
    missingVideoId: 0,
    missingTitle: 0,
    injectedCandidates: 0,
  };
  const seen = new Set<string>();
  const observations: RecommendationObservation[] = [];

  for (const candidate of candidates) {
    if (candidate.injected) {
      metrics.injectedCandidates += 1;
      continue;
    }
    const externalId = extractYouTubeVideoId(candidate.href);
    if (!externalId) {
      metrics.missingVideoId += 1;
      continue;
    }
    const title = normalizeYouTubeText(candidate.title ?? '');
    if (!title) {
      metrics.missingTitle += 1;
      continue;
    }
    const position = observations.length;
    const section = normalizeYouTubeText(candidate.section ?? '') || null;
    const exposureId = createExposureId({ videoId: externalId, surface: 'home', section, position });
    if (seen.has(exposureId)) {
      metrics.duplicateCandidates += 1;
      continue;
    }
    seen.add(exposureId);
    observations.push({
      externalId,
      exposureId,
      title,
      creator: normalizeYouTubeText(candidate.creator ?? '') || null,
      position,
      section,
      observedAt,
      provenance: 'youtube_home_dom',
      evidenceKind: 'surfaced',
      outcome: 'unobserved',
    });
  }
  metrics.usableObservations = observations.length;
  return { observations, metrics };
}

export function collectRecommendationObservationsFromDom(document: Document, observedAt = new Date().toISOString()) {
  const cards = Array.from(document.querySelectorAll<HTMLElement>('ytd-rich-item-renderer, ytd-rich-grid-media, yt-lockup-view-model'));
  const candidates = cards.map((card) => {
    const link = card.querySelector<HTMLAnchorElement>(videoLinkSelector);
    const titleNode = card.querySelector<HTMLElement>('#video-title, #video-title-link, a[title][href*="/watch"], a[aria-label][href*="/watch"], a[title][href*="/shorts/"], a[aria-label][href*="/shorts/"]');
    const isShort = Boolean(link?.href.includes('/shorts/'));
    const creator = extractYouTubeCreator(card);
    const sectionNode = card.closest<HTMLElement>('ytd-rich-section-renderer')?.querySelector<HTMLElement>('#title, h2, h3');
    return {
      href: link?.href ?? '',
      title: isShort
        ? extractYouTubeShortsTitle(card) ?? extractYouTubeLinkTitle({
            title: titleNode?.getAttribute('title'),
            ariaLabel: titleNode?.getAttribute('aria-label'),
            textContent: titleNode?.textContent,
          })
        : extractYouTubeLinkTitle({
            title: titleNode?.getAttribute('title'),
            ariaLabel: titleNode?.getAttribute('aria-label'),
            textContent: titleNode?.textContent,
          }),
      creator,
      section: sectionNode?.textContent,
      injected: Boolean(card.closest('[data-personal-algorithm-shelf], [data-personal-algorithm-replacement], [data-personal-algorithm-status]')),
    };
  });
  return collectRecommendationObservations(candidates, observedAt);
}

export function applyRecommendationOutcome(
  observations: RecommendationObservation[],
  externalId: string,
  outcome: 'clicked' | 'watched',
): RecommendationObservation[] {
  return observations.map((observation) => (
    observation.externalId === externalId && (outcome === 'watched' || observation.outcome === 'unobserved')
      ? { ...observation, outcome }
      : observation
  ));
}

export function mergeRecommendationObservations(
  existing: RecommendationObservation[],
  incoming: RecommendationObservation[],
  limit = 500,
): RecommendationObservation[] {
  const byExposureId = new Map(existing.map((item) => [item.exposureId || createExposureId({ videoId: item.externalId, surface: 'home', section: item.section, position: item.position }), item]));
  for (const observation of incoming) {
    const previous = byExposureId.get(observation.exposureId);
    byExposureId.set(observation.exposureId, {
      ...observation,
      outcome: previous?.outcome && previous.outcome !== 'unobserved'
        ? previous.outcome
        : observation.outcome,
    });
  }
  return [...byExposureId.values()].slice(-limit);
}