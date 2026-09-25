import { extractYouTubeCreator, extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText, videoLinkSelector } from './youtube-dom.ts';

export type HistoryEvidence = {
  externalId: string;
  title: string;
  creator: string | null;
  historyTimestamp: string | null;
  historyPosition: number;
  observedAt: string;
  provenance: 'youtube_history_dom';
};

export type HistoryObservationCandidate = {
  href: string;
  title?: string | null;
  creator?: string | null;
  historyTimestamp?: string | null;
  position?: number;
  injected?: boolean;
};

export type HistoryObservationMetrics = {
  observedCandidates: number;
  usableEvidence: number;
  duplicateCandidates: number;
  missingVideoId: number;
  missingTitle: number;
  injectedCandidates: number;
  creatorPresent: number;
  creatorCoverageRate: number;
  durationSuffixedTitles: number;
  placeholderTitles: number;
};

export function isYouTubeHistoryPage(pathname: string): boolean {
  return pathname.replace(/\/+$/, '') === '/feed/history';
}

export function collectHistoryEvidence(
  candidates: HistoryObservationCandidate[],
  observedAt = new Date().toISOString(),
): { evidence: HistoryEvidence[]; metrics: HistoryObservationMetrics } {
  const metrics: HistoryObservationMetrics = {
    observedCandidates: candidates.length,
    usableEvidence: 0,
    duplicateCandidates: 0,
    missingVideoId: 0,
    missingTitle: 0,
    injectedCandidates: 0,
    creatorPresent: 0,
    creatorCoverageRate: 0,
    durationSuffixedTitles: 0,
    placeholderTitles: 0,
  };
  const seen = new Set<string>();
  const evidence: HistoryEvidence[] = [];

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

    const rawTitle = normalizeYouTubeText(candidate.title ?? '');
    if (!rawTitle) {
      metrics.missingTitle += 1;
      continue;
    }

    if (rawTitle === 'Watch') {
      metrics.placeholderTitles += 1;
      continue;
    }
    if (/\b\d+\s+(?:seconds?|minutes?|hours?)(?:\s*,\s*\d+\s+(?:seconds?|minutes?|hours?))*\s*(?:ago)?$/i.test(rawTitle)) {
      metrics.durationSuffixedTitles += 1;
    }
    const title = rawTitle.replace(/\s+\b\d+\s+(?:seconds?|minutes?|hours?)(?:\s*,\s*\d+\s+(?:seconds?|minutes?|hours?))*\s*(?:ago)?$/i, '').trim();
    if (!title) {
      metrics.missingTitle += 1;
      continue;
    }

    const creator = normalizeYouTubeText(candidate.creator ?? '') || null;

    if (seen.has(externalId)) {
      metrics.duplicateCandidates += 1;
      continue;
    }
    seen.add(externalId);
    if (creator) {
      metrics.creatorPresent += 1;
    }

    evidence.push({
      externalId,
      title,
      creator,
      historyTimestamp: normalizeYouTubeText(candidate.historyTimestamp ?? '') || null,
      historyPosition: candidate.position ?? evidence.length,
      observedAt,
      provenance: 'youtube_history_dom',
    });
  }

  metrics.usableEvidence = evidence.length;
  metrics.creatorCoverageRate = evidence.length > 0
    ? Number((metrics.creatorPresent / evidence.length).toFixed(4))
    : 0;
  return { evidence, metrics };
}

export function collectHistoryEvidenceFromDom(document: Document, observedAt = new Date().toISOString()) {
  const knownRows = Array.from(document.querySelectorAll<HTMLElement>(
    'ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, yt-lockup-view-model',
  ));

  const linkRows = Array.from(document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/watch?v="], a[href*="/shorts/"]',
  ))
    .map((link) => {
      const knownRow = link.closest(
        'ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, yt-lockup-view-model',
      ) as HTMLElement | null;
      if (knownRow) return knownRow;

      let current: HTMLElement | null = link.parentElement;
      for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
        const hasVideoLink = current.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
        const hasTitleNode = current.querySelector(
          '#video-title, #video-title-link, yt-formatted-string#video-title, a[title], a[aria-label]',
        );
        const text = normalizeYouTubeText(current.textContent ?? '');
        if (hasVideoLink && hasTitleNode && text.length > 12 && text.length < 1200) {
          return current;
        }
      }
      return null;
    })
    .filter((row): row is HTMLElement => Boolean(row));

  const rows = Array.from(new Set([...knownRows, ...linkRows]));
  const candidates = rows.map((row, position) => {
    const link = row.querySelector<HTMLAnchorElement>([
      videoLinkSelector,
      'a#thumbnail[href]',
      'a#video-title-link[href]',
      'a#video-title[href]',
      'a[href*="/watch?v="]',
      'a[href*="/shorts/"]',
    ].join(','));
    const titleNode = row.querySelector<HTMLElement>('#video-title, #video-title-link, a[title][href*="/watch"], a[aria-label][href*="/watch"]');
    const creator = extractYouTubeCreator(row);
    const timestampNode = row.querySelector<HTMLElement>('#metadata-line span:last-child, #metadata span:last-child, ytd-video-meta-block span:last-child');

    return {
      href: link?.href ?? '',
      title: extractYouTubeLinkTitle({
        title: titleNode?.getAttribute('title'),
        ariaLabel: titleNode?.getAttribute('aria-label'),
        textContent: titleNode?.textContent,
      }),
      creator,
      historyTimestamp: timestampNode?.textContent,
      position,
      injected: Boolean(row.closest('[data-personal-algorithm-shelf], [data-personal-algorithm-replacement], [data-personal-algorithm-status]')),
    };
  });

  return collectHistoryEvidence(candidates, observedAt);
}


/**
 * Reconciles the latest ordered History snapshot with the retained local
 * History view. YouTube's rendered History does not expose a stable watched-at
 * timestamp, so the video ID is the stable identity and DOM order is retained
 * only as relative recency (0 = newest observed card).
 *
 * Repeated scans update the same video's metadata/position instead of creating
 * another watch event. This matches the History UI's content-level representation
 * and avoids treating collector observation time as watch-event identity.
 */
export function mergeHistoryEvidence(
  existing: HistoryEvidence[],
  incoming: HistoryEvidence[],
): HistoryEvidence[] {
  const byExternalId = new Map<string, HistoryEvidence>();

  for (const item of existing) {
    if (!item?.externalId) continue;
    byExternalId.set(item.externalId, {
      ...item,
      historyPosition: item.historyPosition ?? 0,
    });
  }

  for (const item of incoming) {
    if (!item?.externalId) continue;
    const previous = byExternalId.get(item.externalId);
    byExternalId.set(item.externalId, {
      ...previous,
      ...item,
      historyPosition: item.historyPosition,
    });
  }

  const incomingIds = new Set(incoming.map((item) => item.externalId));
  const merged = [
    ...incoming.filter((item) => byExternalId.has(item.externalId)).map((item) => byExternalId.get(item.externalId)!),
    ...[...byExternalId.values()].filter((item) => !incomingIds.has(item.externalId)),
  ];

  return merged
    .sort((a, b) => a.historyPosition - b.historyPosition);
}
