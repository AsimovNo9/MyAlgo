import { extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText, videoLinkSelector } from './youtube-dom.ts';

export type RecommendationObservation = {
  externalId: string;
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
    if (seen.has(externalId)) {
      metrics.duplicateCandidates += 1;
      continue;
    }
    seen.add(externalId);
    observations.push({
      externalId,
      title,
      creator: normalizeYouTubeText(candidate.creator ?? '') || null,
      position: observations.length,
      section: normalizeYouTubeText(candidate.section ?? '') || null,
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
  const cards = Array.from(document.querySelectorAll<HTMLElement>('ytd-rich-item-renderer, ytd-rich-grid-media'));
  const candidates = cards.map((card) => {
    const link = card.querySelector<HTMLAnchorElement>(videoLinkSelector);
    const titleNode = card.querySelector<HTMLElement>('#video-title, #video-title-link, a[title][href*="/watch"], a[aria-label][href*="/watch"]');
    const creatorNode = card.querySelector<HTMLElement>('#channel-name, ytd-channel-name, .ytd-channel-name');
    const sectionNode = card.closest<HTMLElement>('ytd-rich-section-renderer')?.querySelector<HTMLElement>('#title, h2, h3');
    return {
      href: link?.href ?? '',
      title: extractYouTubeLinkTitle({
        title: titleNode?.getAttribute('title'),
        ariaLabel: titleNode?.getAttribute('aria-label'),
        textContent: titleNode?.textContent,
      }),
      creator: creatorNode?.textContent,
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
  const byExternalId = new Map(existing.map((item) => [item.externalId, item]));
  for (const observation of incoming) {
    const previous = byExternalId.get(observation.externalId);
    byExternalId.set(observation.externalId, {
      ...observation,
      outcome: previous?.outcome && previous.outcome !== 'unobserved'
        ? previous.outcome
        : observation.outcome,
    });
  }
  return [...byExternalId.values()].slice(-limit);
}