import type { ExposureEvidence, InteractionEvidence } from '@repo/shared-types';
import { correlateEvidence, type EvidenceTimeline } from '../lib/evidence-correlation.ts';
import { toNormalizedExposure, type RecommendationObservation } from './youtube-recommendations.ts';
import {
  toNormalizedInteraction,
  type SelectionObservation,
  type UserBehaviorObservation,
  type WatchedObservation,
} from './youtube-interactions.ts';

export type BehaviorCorrelationKind =
  | 'surfaced_clicked'
  | 'clicked_watched'
  | 'surfaced_watched';

export type BehaviorCorrelation = {
  kind: BehaviorCorrelationKind;
  videoId: string;
  surfacedAt?: string;
  surfacedExposureId?: string;
  clickedAt?: string;
  clickedExposureId?: string | null;
  watchedAt?: string;
};

export type BehaviorTimeline = {
  videoId: string;
  surfaced: RecommendationObservation[];
  clicked: SelectionObservation[];
  watched: WatchedObservation[];
  correlations: BehaviorCorrelation[];
};

function toYouTubeTimeline(
  timeline: EvidenceTimeline,
  surfaced: RecommendationObservation[],
  interactions: UserBehaviorObservation[],
): BehaviorTimeline {
  const videoId = timeline.content.externalId;
  return {
    videoId,
    surfaced: surfaced.filter((item) => item.externalId === videoId && item.evidenceKind === 'surfaced')
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt)),
    clicked: interactions.filter((event): event is SelectionObservation =>
      event.videoId === videoId
      && (event.kind === 'click' || event.kind === 'auxclick' || event.kind === 'keyboard')
    ).sort((a, b) => a.observedAt.localeCompare(b.observedAt)),
    watched: interactions.filter((event): event is WatchedObservation =>
      event.videoId === videoId && event.kind === 'watched'
    ).sort((a, b) => a.observedAt.localeCompare(b.observedAt)),
    correlations: timeline.correlations.map((correlation) => ({
      kind: correlation.kind,
      videoId,
      surfacedAt: correlation.surfacedAt,
      surfacedExposureId: correlation.surfacedExposureId,
      clickedAt: correlation.clickedAt,
      clickedExposureId: correlation.clickedExposureId,
      watchedAt: correlation.watchedAt,
    })),
  };
}

function normalizeYouTubeEvidence(
  surfaced: RecommendationObservation[],
  interactions: UserBehaviorObservation[],
): {
  exposures: ExposureEvidence[];
  interactions: InteractionEvidence[];
} {
  return {
    exposures: surfaced
      .filter((observation) => observation.externalId && observation.evidenceKind === 'surfaced')
      .map(toNormalizedExposure),
    interactions: interactions
      .filter((event) => event.videoId)
      .map(toNormalizedInteraction),
  };
}

export function correlateBehavior(
  surfaced: RecommendationObservation[],
  interactions: UserBehaviorObservation[],
): BehaviorTimeline[] {
  const normalized = normalizeYouTubeEvidence(surfaced, interactions);
  const timelines = correlateEvidence(normalized.exposures, normalized.interactions);
  return timelines.map((timeline) => toYouTubeTimeline(timeline, surfaced, interactions));
}

export function getBehaviorForVideo(
  videoId: string,
  surfaced: RecommendationObservation[],
  interactions: UserBehaviorObservation[],
): BehaviorTimeline | null {
  return correlateBehavior(surfaced, interactions).find((timeline) => timeline.videoId === videoId) ?? null;
}
