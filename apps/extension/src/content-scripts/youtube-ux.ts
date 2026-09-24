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
};

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
