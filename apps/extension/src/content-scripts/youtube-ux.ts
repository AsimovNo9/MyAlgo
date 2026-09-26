export type VideoCandidate = {
  external_id?: string;
  title?: string | null;
  channel_name?: string | null;
  is_short?: boolean;
  is_live?: boolean;
};

export type RankedFeedItem = {
  external_id?: string;
  title?: string | null;
  channel_name?: string | null;
  thumbnail_url?: string | null;
  visible?: boolean;
  score?: number;
  suppressed?: boolean;
  policyOutcome?: 'eligible' | 'ineligible' | 'excluded' | 'suppressed';
};

export const MYALGO_INJECTED_SELECTOR = [
  '[data-personal-algorithm-shelf]',
  '[data-personal-algorithm-replacement]',
  '[data-personal-algorithm-status]',
  '[data-personal-algorithm-explanation]',
  '[data-personal-algorithm-control]',
].join(', ');

export function isMyAlgoInjectedElement(element: Element | null): boolean {
  return Boolean(element?.closest(MYALGO_INJECTED_SELECTOR));
}

export type NativeCardDecision =
  | { action: 'show'; reason: 'ranked' | 'unmatched' }
  | { action: 'hide'; reason: 'source_filter' | 'runtime_policy' | 'score' };

export function getNativeCardDecision(
  item: RankedFeedItem | undefined,
  options: { sourceFiltered: boolean; minimumVisibleScore: number },
): NativeCardDecision {
  // Hard/runtime policy gates always win before score-based presentation.
  if (options.sourceFiltered) return { action: 'hide', reason: 'source_filter' };
  if (
    item?.visible === false
    || item?.suppressed === true
    || (item?.policyOutcome != null && item.policyOutcome !== 'eligible')
  ) {
    return { action: 'hide', reason: 'runtime_policy' };
  }

  // Missing coverage is a degraded/pass-through state, not a reason to erase
  // YouTube-owned cards that MyAlgo has not scored.
  if (!item) return { action: 'show', reason: 'unmatched' };

  if ((item.score ?? 0) < options.minimumVisibleScore) {
    return { action: 'hide', reason: 'score' };
  }
  return { action: 'show', reason: 'ranked' };
}

export type RenderContext = {
  generation: number;
  routeKey: string;
  mode: string;
};

export function isRenderContextStale(request: RenderContext, current: RenderContext): boolean {
  return request.generation !== current.generation
    || request.routeKey !== current.routeKey
    || request.mode !== current.mode;
}

export function dedupeCandidatesById<T extends VideoCandidate>(candidates: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const candidate of candidates) {
    const id = candidate.external_id?.trim();
    if (!id || !candidate.title || seen.has(id)) continue;
    seen.add(id);
    deduped.push(candidate);
  }

  return deduped;
}

export function getShelfCandidates(
  items: RankedFeedItem[],
  limit = 6,
  blockedIds: Iterable<string | undefined> = [],
  minimumScore = 52,
): RankedFeedItem[] {
  const seen = new Set(Array.from(blockedIds).filter((id): id is string => Boolean(id && id.trim())));
  return items.filter((item) => {
    const id = item.external_id?.trim();
    if (!id || !item.title || seen.has(id) || item.visible === false || (item.score ?? 0) < minimumScore) {
      return false;
    }
    seen.add(id);
    return true;
  }).slice(0, limit);
}

export function getReplacementCandidates(
  items: RankedFeedItem[],
  blockedIds: Iterable<string | undefined>,
  limit = 6,
  minimumScore = 52,
): RankedFeedItem[] {
  const blocked = new Set(Array.from(blockedIds).filter((id): id is string => Boolean(id && id.trim())));
  const seen = new Set<string>();

  return items.filter((item) => {
    const id = item.external_id?.trim();
    if (!id || !item.title || blocked.has(id) || seen.has(id) || item.visible === false || (item.score ?? 0) < minimumScore) {
      return false;
    }
    seen.add(id);
    return true;
  }).slice(0, limit);
}

export function isRenderGenerationStale(requestGeneration: number, latestGeneration: number): boolean {
  return requestGeneration !== latestGeneration;
}

export function shouldHideForSourceFilters(
  source: { is_short?: boolean; is_live?: boolean },
  filters: { includeShorts?: boolean; includeLive?: boolean },
): boolean {
  return (source.is_short === true && filters.includeShorts === false)
    || (source.is_live === true && filters.includeLive === false);
}
