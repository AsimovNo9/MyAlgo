import type {
  ContentIdentity,
  ExposureEvidence,
  InteractionEvidence,
} from '@repo/shared-types';

export type EvidenceCorrelationKind =
  | 'surfaced_clicked'
  | 'clicked_watched'
  | 'surfaced_watched';

export type EvidenceCorrelation = {
  kind: EvidenceCorrelationKind;
  content: ContentIdentity;
  surfacedAt?: string;
  surfacedExposureId?: string;
  clickedAt?: string;
  clickedExposureId?: string | null;
  watchedAt?: string;
};

export type EvidenceTimeline = {
  content: ContentIdentity;
  exposures: ExposureEvidence[];
  interactions: InteractionEvidence[];
  correlations: EvidenceCorrelation[];
};

const sortEvidence = <T extends { observedAt: string }>(events: T[]): T[] =>
  [...events].sort((a, b) => {
    const time = a.observedAt.localeCompare(b.observedAt);
    return time || JSON.stringify(a).localeCompare(JSON.stringify(b));
  });

const contentKey = (content: ContentIdentity): string =>
  JSON.stringify([content.source, content.externalId]);

function findExposureForClick(
  exposures: ExposureEvidence[],
  clicked: InteractionEvidence,
): ExposureEvidence | undefined {
  if (clicked.exposureId) {
    return exposures.find((exposure) =>
      exposure.exposureId === clicked.exposureId
      && exposure.content.source === clicked.content.source
      && exposure.content.externalId === clicked.content.externalId
    );
  }

  const candidates = exposures.filter((exposure) =>
    exposure.content.source === clicked.content.source
    && exposure.content.externalId === clicked.content.externalId
  );
  if (candidates.length === 0) return undefined;

  const atOrBefore = candidates
    .filter((exposure) => exposure.observedAt <= clicked.observedAt)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  return atOrBefore[0] ?? sortEvidence(candidates)[0];
}

export function correlateEvidence(
  exposures: ExposureEvidence[],
  interactions: InteractionEvidence[],
): EvidenceTimeline[] {
  const exposureGroups = new Map<string, ExposureEvidence[]>();
  const interactionGroups = new Map<string, InteractionEvidence[]>();

  for (const exposure of exposures) {
    const key = contentKey(exposure.content);
    const list = exposureGroups.get(key) ?? [];
    list.push(exposure);
    exposureGroups.set(key, list);
  }

  for (const interaction of interactions) {
    const key = contentKey(interaction.content);
    const list = interactionGroups.get(key) ?? [];
    list.push(interaction);
    interactionGroups.set(key, list);
  }

  const contentKeys = [...new Set([
    ...exposureGroups.keys(),
    ...interactionGroups.keys(),
  ])].sort();

  return contentKeys.map((key) => {
    const exposuresForContent = sortEvidence(exposureGroups.get(key) ?? []);
    const interactionsForContent = sortEvidence(interactionGroups.get(key) ?? []);
    const clicks = interactionsForContent.filter((event) => event.interaction === 'clicked');
    const watches = interactionsForContent.filter((event) => event.interaction === 'watched');
    const correlations: EvidenceCorrelation[] = [];
    const content = exposuresForContent[0]?.content ?? interactionsForContent[0].content;

    for (const click of clicks) {
      const match = findExposureForClick(exposuresForContent, click);
      if (match) {
        correlations.push({
          kind: 'surfaced_clicked',
          content,
          surfacedAt: match.observedAt,
          surfacedExposureId: match.exposureId,
          clickedAt: click.observedAt,
          clickedExposureId: click.exposureId,
        });
      }
    }

    for (const watch of watches) {
      const priorClicks = clicks
        .filter((event) => event.observedAt <= watch.observedAt)
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
      const matchedClick = watch.exposureId
        ? priorClicks.find((event) => event.exposureId === watch.exposureId)
        : priorClicks[0];

      if (matchedClick) {
        correlations.push({
          kind: 'clicked_watched',
          content,
          clickedAt: matchedClick.observedAt,
          clickedExposureId: matchedClick.exposureId,
          watchedAt: watch.observedAt,
        });
      }

      const priorExposures = exposuresForContent
        .filter((item) => item.observedAt <= watch.observedAt)
        .sort((a, b) => b.observedAt.localeCompare(a.observedAt));
      const matchedExposure = watch.exposureId
        ? priorExposures.find((item) => item.exposureId === watch.exposureId)
        : matchedClick?.exposureId
          ? priorExposures.find((item) => item.exposureId === matchedClick.exposureId)
          : priorExposures[0];

      if (matchedExposure) {
        correlations.push({
          kind: 'surfaced_watched',
          content,
          surfacedAt: matchedExposure.observedAt,
          surfacedExposureId: matchedExposure.exposureId,
          watchedAt: watch.observedAt,
        });
      }
    }

    return {
      content,
      exposures: exposuresForContent,
      interactions: interactionsForContent,
      correlations,
    };
  });
}
