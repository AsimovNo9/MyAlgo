import type { ExposureEvidence, InteractionEvidence } from '@repo/shared-types';
import { toNormalizedExposure, type RecommendationObservation } from './youtube-recommendations.ts';
import {
  toNormalizedInteraction,
  type SelectionObservation,
  type UserBehaviorObservation,
  type WatchedObservation,
} from './youtube-interactions.ts';
import { createExposureId } from './youtube-interactions.ts';

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

const eventTime = (event: { observedAt: string }) => event.observedAt;

const sortEvents = <T extends { observedAt: string }>(events: T[]): T[] =>
  [...events].sort((a, b) => {
    const time = eventTime(a).localeCompare(eventTime(b));
    return time || JSON.stringify(a).localeCompare(JSON.stringify(b));
  });

const getRecommendationExposureId = (observation: RecommendationObservation): string =>
  observation.exposureId || createExposureId({
    videoId: observation.externalId,
    surface: 'home',
    section: observation.section,
    position: observation.position,
  });

function correlateSelection(
  surfaced: ExposureEvidence[],
  clicked: InteractionEvidence,
): ExposureEvidence | undefined {
  if (clicked.exposureId) {
    const exact = surfaced.find((item) =>
      item.content.externalId === clicked.content.externalId
      && item.exposureId === clicked.exposureId
    );
    // An explicit exposure ID is authoritative. If it is present but does not
    // match this video's surfaced evidence, do not weaken the identity boundary
    // by falling back to content-only correlation.
    return exact;
  }

  const candidates = surfaced.filter((item) => item.content.externalId === clicked.content.externalId);
  if (candidates.length === 0) return undefined;

  const atOrBefore = candidates
    .filter((item) => item.observedAt <= clicked.observedAt)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return atOrBefore[0] ?? [...candidates].sort((a, b) => a.observedAt.localeCompare(b.observedAt))[0];
}

export function correlateBehavior(
  surfaced: RecommendationObservation[],
  interactions: UserBehaviorObservation[],
): BehaviorTimeline[] {
  // Convert provider-shaped observations once at the connector boundary. The
  // correlation algorithm below only reasons over source-neutral evidence.
  const normalizedSurfaced = surfaced
    .filter((observation) => observation.externalId && observation.evidenceKind === 'surfaced')
    .map(toNormalizedExposure);
  const normalizedInteractions = interactions
    .filter((event) => event.videoId)
    .map(toNormalizedInteraction);

  const surfacedByContent = new Map<string, ExposureEvidence[]>();
  const clickedByContent = new Map<string, InteractionEvidence[]>();
  const watchedByContent = new Map<string, InteractionEvidence[]>();

  for (const observation of normalizedSurfaced) {
    const list = surfacedByContent.get(observation.content.externalId) ?? [];
    list.push(observation);
    surfacedByContent.set(observation.content.externalId, list);
  }

  for (const event of normalizedInteractions) {
    const target = event.interaction === 'watched' ? watchedByContent : clickedByContent;
    const list = target.get(event.content.externalId) ?? [];
    list.push(event);
    target.set(event.content.externalId, list);
  }

  const videoIds = [...new Set([
    ...surfacedByContent.keys(),
    ...clickedByContent.keys(),
    ...watchedByContent.keys(),
  ])].sort();

  return videoIds.map((videoId) => {
    const videoSurfaced = sortEvents(surfaced.filter((item) =>
      item.externalId === videoId && item.evidenceKind === 'surfaced'
    ));
    const clicked = sortEvents(interactions.filter((event) =>
      event.videoId === videoId && event.kind !== 'watched'
    )) as SelectionObservation[];
    const watched = sortEvents(interactions.filter((event) =>
      event.videoId === videoId && event.kind === 'watched'
    )) as WatchedObservation[];

    const normalizedSurfacedForVideo = sortEvents(surfacedByContent.get(videoId) ?? []);
    const normalizedClicked = sortEvents(clickedByContent.get(videoId) ?? []);
    const normalizedWatched = sortEvents(watchedByContent.get(videoId) ?? []);
    const correlations: BehaviorCorrelation[] = [];

    for (const click of normalizedClicked) {
      const match = correlateSelection(normalizedSurfacedForVideo, click);
      if (match) {
        correlations.push({
          kind: 'surfaced_clicked',
          videoId,
          surfacedAt: match.observedAt,
          surfacedExposureId: match.exposureId,
          clickedAt: click.observedAt,
          clickedExposureId: click.exposureId,
        });
      }
    }

    for (const watch of normalizedWatched) {
      for (const click of normalizedClicked.filter((event) => event.observedAt <= watch.observedAt)) {
        correlations.push({
          kind: 'clicked_watched',
          videoId,
          clickedAt: click.observedAt,
          clickedExposureId: click.exposureId,
          watchedAt: watch.observedAt,
        });
      }
      for (const exposure of normalizedSurfacedForVideo.filter((item) => item.observedAt <= watch.observedAt)) {
        correlations.push({
          kind: 'surfaced_watched',
          videoId,
          surfacedAt: exposure.observedAt,
          surfacedExposureId: exposure.exposureId,
          watchedAt: watch.observedAt,
        });
      }
    }

    return { videoId, surfaced: videoSurfaced, clicked, watched, correlations };
  });
}

export function getBehaviorForVideo(
  videoId: string,
  surfaced: RecommendationObservation[],
  interactions: UserBehaviorObservation[],
): BehaviorTimeline | null {
  return correlateBehavior(surfaced, interactions).find((timeline) => timeline.videoId === videoId) ?? null;
}
