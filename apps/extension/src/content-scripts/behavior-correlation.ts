import type { RecommendationObservation } from './youtube-recommendations.ts';
import type { SelectionObservation, UserBehaviorObservation, WatchedObservation } from './youtube-interactions.ts';
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
  surfaced: RecommendationObservation[],
  clicked: SelectionObservation,
): RecommendationObservation | undefined {
  if (clicked.exposureId) {
    const exact = surfaced.find((item) =>
      item.externalId === clicked.videoId && getRecommendationExposureId(item) === clicked.exposureId
    );
    if (exact) return exact;
  }

  const candidates = surfaced.filter((item) => item.externalId === clicked.videoId);
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
  const surfacedByVideo = new Map<string, RecommendationObservation[]>();
  const clickedByVideo = new Map<string, SelectionObservation[]>();
  const watchedByVideo = new Map<string, WatchedObservation[]>();

  for (const observation of surfaced) {
    if (!observation.externalId || observation.evidenceKind !== 'surfaced') continue;
    const list = surfacedByVideo.get(observation.externalId) ?? [];
    list.push(observation);
    surfacedByVideo.set(observation.externalId, list);
  }

  for (const event of interactions) {
    if (!event.videoId) continue;
    if (event.kind === 'watched') {
      const list = watchedByVideo.get(event.videoId) ?? [];
      list.push(event);
      watchedByVideo.set(event.videoId, list);
    } else {
      const list = clickedByVideo.get(event.videoId) ?? [];
      list.push(event);
      clickedByVideo.set(event.videoId, list);
    }
  }

  const videoIds = [...new Set([
    ...surfacedByVideo.keys(),
    ...clickedByVideo.keys(),
    ...watchedByVideo.keys(),
  ])].sort();

  return videoIds.map((videoId) => {
    const videoSurfaced = sortEvents(surfacedByVideo.get(videoId) ?? []);
    const clicked = sortEvents(clickedByVideo.get(videoId) ?? []);
    const watched = sortEvents(watchedByVideo.get(videoId) ?? []);
    const correlations: BehaviorCorrelation[] = [];

    for (const click of clicked) {
      const match = correlateSelection(videoSurfaced, click);
      if (match) {
        correlations.push({
          kind: 'surfaced_clicked',
          videoId,
          surfacedAt: match.observedAt,
          surfacedExposureId: getRecommendationExposureId(match),
          clickedAt: click.observedAt,
          clickedExposureId: click.exposureId,
        });
      }
    }

    for (const watch of watched) {
      for (const click of clicked.filter((event) => event.observedAt <= watch.observedAt)) {
        correlations.push({
          kind: 'clicked_watched',
          videoId,
          clickedAt: click.observedAt,
          clickedExposureId: click.exposureId,
          watchedAt: watch.observedAt,
        });
      }
      for (const exposure of videoSurfaced.filter((item) => item.observedAt <= watch.observedAt)) {
        correlations.push({
          kind: 'surfaced_watched',
          videoId,
          surfacedAt: exposure.observedAt,
          surfacedExposureId: getRecommendationExposureId(exposure),
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
