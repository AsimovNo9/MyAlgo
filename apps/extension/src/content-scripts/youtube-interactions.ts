import { extractYouTubeVideoId } from './youtube-dom.ts';

export type YouTubeSurface = 'home' | 'search' | 'subscriptions' | 'shorts' | 'watch' | 'other';

export type SelectionKind = 'click' | 'auxclick' | 'keyboard';

export type SelectionSource = 'thumbnail' | 'title' | 'card' | 'keyboard' | 'unknown';

export type CandidateExposure = {
  exposureId: string;
  videoId: string;
  surface: YouTubeSurface;
  section: string | null;
  position: number | null;
};

export type SelectionObservation = {
  videoId: string;
  exposureId: string | null;
  kind: SelectionKind;
  source: SelectionSource;
  observedAt: string;
  provenance: 'youtube_user_interaction';
};

export type HistoryWatchedObservation = {
  videoId: string;
  exposureId: string | null;
  sessionId?: never;
  kind: 'watched';
  source: 'history';
  observedAt: string;
  provenance: 'youtube_history_dom';
};

export type PlayerWatchedObservation = import('./youtube-watch.ts').TemporalWatchObservation;

export type WatchedObservation = HistoryWatchedObservation | PlayerWatchedObservation;

export type UserBehaviorObservation = SelectionObservation | WatchedObservation;

const normalize = (value: string | null | undefined) =>
  value?.replace(/\s+/g, ' ').trim() || null;

export function getYouTubeSurface(pathname: string, card: Element | null = null): YouTubeSurface {
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname === '/results') return 'search';
  if (pathname === '/feed/subscriptions' || pathname.startsWith('/feed/subscriptions/')) return 'subscriptions';
  if (pathname.startsWith('/shorts/')) return 'shorts';
  if (pathname === '/watch') return 'watch';

  if (card?.closest('ytd-search')) return 'search';
  if (card?.closest('ytd-browse[page-subtype="subscriptions"], ytd-browse[page-subtype="subscriptions-home"]')) return 'subscriptions';
  if (card?.closest('ytd-watch-flexy')) return 'watch';
  if (card?.closest('ytd-browse[page-subtype="home"], ytd-rich-grid-renderer')) return 'home';
  if (card?.closest('ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts]')) return 'shorts';
  return 'other';
}

export function createExposureId(input: {
  videoId: string;
  surface: YouTubeSurface;
  section: string | null;
  position: number | null;
}): string {
  return [
    input.videoId,
    input.surface,
    input.section ?? '',
    input.position == null ? '' : String(input.position),
  ].join('|');
}

export function getSelectionSource(target: Element | null): SelectionSource {
  if (!target) return 'unknown';
  if (target.closest('#thumbnail, a.yt-lockup-view-model__content-image, a[href*="/shorts/"]')) {
    return 'thumbnail';
  }
  if (target.closest('#video-title, #video-title-link, a.yt-lockup-metadata-view-model__title')) {
    return 'title';
  }
  return 'card';
}

export function getSurfaceSection(card: Element | null): string | null {
  if (!card) return null;
  const section = card.closest<HTMLElement>(
    'ytd-rich-section-renderer, ytd-item-section-renderer, ytd-shelf-renderer',
  )?.querySelector<HTMLElement>('#title, h2, h3, yt-formatted-string#title')?.textContent;
  return normalize(section);
}

export function getCardPosition(card: Element | null, videoSelector: string): number | null {
  if (!card) return null;
  const cards = Array.from(document.querySelectorAll<HTMLElement>(videoSelector));
  const index = cards.indexOf(card as HTMLElement);
  return index >= 0 ? index : null;
}

export function getSelectionFromTarget(
  target: Element | null,
  videoSelector: string,
  surfaceOrPathname: YouTubeSurface | string,
): { videoId: string; exposure: CandidateExposure; source: SelectionSource } | null {
  if (!target || target.closest('[data-personal-algorithm-shelf], [data-personal-algorithm-replacement], [data-personal-algorithm-status]')) {
    return null;
  }

  const link = target.closest<HTMLAnchorElement>('a[href*="/watch?v="], a[href*="/shorts/"]');
  if (!link) return null;

  const videoId = extractYouTubeVideoId(link.href);
  if (!videoId) return null;

  const card = link.closest(videoSelector);
  const section = getSurfaceSection(card);
  const surface = ['home', 'search', 'subscriptions', 'shorts', 'watch'].includes(surfaceOrPathname)
    ? surfaceOrPathname as YouTubeSurface
    : getYouTubeSurface(surfaceOrPathname, card);
  const position = getCardPosition(card, videoSelector);
  const exposure: CandidateExposure = {
    videoId,
    surface,
    section,
    position,
    exposureId: createExposureId({ videoId, surface, section, position }),
  };

  return { videoId, exposure, source: getSelectionSource(target) };
}

export function createSelectionObservation(
  selection: { videoId: string; exposure: CandidateExposure; source: SelectionSource },
  kind: SelectionKind,
  observedAt = new Date().toISOString(),
): SelectionObservation {
  return {
    videoId: selection.videoId,
    exposureId: selection.exposure.exposureId,
    kind,
    source: kind === 'keyboard' ? 'keyboard' : selection.source,
    observedAt,
    provenance: 'youtube_user_interaction',
  };
}
