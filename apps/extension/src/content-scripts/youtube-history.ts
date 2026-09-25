import { extractYouTubeLinkTitle, extractYouTubeVideoId, normalizeYouTubeText, videoLinkSelector } from './youtube-dom.ts';

export type HistoryEvidence = {
  externalId: string;
  title: string;
  creator: string | null;
  historyTimestamp: string | null;
  observedAt: string;
  provenance: 'youtube_history_dom';
};

export type HistoryObservationCandidate = {
  href: string;
  title?: string | null;
  creator?: string | null;
  historyTimestamp?: string | null;
  injected?: boolean;
};

export type HistoryObservationMetrics = {
  observedCandidates: number;
  usableEvidence: number;
  duplicateCandidates: number;
  missingVideoId: number;
  missingTitle: number;
  injectedCandidates: number;
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

    evidence.push({
      externalId,
      title,
      creator: normalizeYouTubeText(candidate.creator ?? '') || null,
      historyTimestamp: normalizeYouTubeText(candidate.historyTimestamp ?? '') || null,
      observedAt,
      provenance: 'youtube_history_dom',
    });
  }

  metrics.usableEvidence = evidence.length;
  return { evidence, metrics };
}

export function collectHistoryEvidenceFromDom(document: Document, observedAt = new Date().toISOString()) {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(
    'ytd-video-renderer, ytd-grid-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer',
  ));
  const candidates = rows.map((row) => {
    const link = row.querySelector<HTMLAnchorElement>([
      videoLinkSelector,
      'a#thumbnail[href]',
      'a#video-title-link[href]',
      'a#video-title[href]',
      'a[href*="/watch?v="]',
      'a[href*="/shorts/"]',
    ].join(','));
    const titleNode = row.querySelector<HTMLElement>('#video-title, #video-title-link, a[title][href*="/watch"], a[aria-label][href*="/watch"]');
    const creatorNode = row.querySelector<HTMLElement>('#channel-name, ytd-channel-name, .ytd-channel-name');
    const timestampNode = row.querySelector<HTMLElement>('#metadata-line span:last-child, #metadata span:last-child, ytd-video-meta-block span:last-child');

    return {
      href: link?.href ?? '',
      title: extractYouTubeLinkTitle({
        title: titleNode?.getAttribute('title'),
        ariaLabel: titleNode?.getAttribute('aria-label'),
        textContent: titleNode?.textContent,
      }),
      creator: creatorNode?.textContent,
      historyTimestamp: timestampNode?.textContent,
      injected: Boolean(row.closest('[data-personal-algorithm-shelf], [data-personal-algorithm-replacement], [data-personal-algorithm-status]')),
    };
  });

  return collectHistoryEvidence(candidates, observedAt);
}
