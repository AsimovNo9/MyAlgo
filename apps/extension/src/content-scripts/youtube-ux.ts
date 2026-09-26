export type VideoCandidate = {
  external_id?: string;
  title?: string | null;
  channel_name?: string | null;
  is_short?: boolean;
  is_live?: boolean;
  content_label?: 'learning' | 'work' | 'relax' | null;
  content_label_confidence?: number | null;
  provenance?: {
    mechanism?: string | null;
    acquired_at?: string | null;
  };
  acquisition_history?: Array<{
    mechanism?: string | null;
    acquired_at?: string | null;
  }>;
};

export type RankedFeedItem = {
  external_id?: string;
  title?: string | null;
  channel_name?: string | null;
  thumbnail_url?: string | null;
  visible?: boolean;
  rawScore?: number;
  score?: number;
  explanation?: {
    rawScore: number;
    displayScore: number;
    graphRevision: number;
    acquisitionMechanism: string | null;
    contributions: Array<{ label: string; value: number; kind: string }>;
  };
  suppressed?: boolean;
  policyOutcome?: 'eligible' | 'ineligible' | 'excluded' | 'suppressed';
  traceId?: string;
  is_short?: boolean;
  is_live?: boolean;
  content_label?: 'learning' | 'work' | 'relax' | null;
  content_label_confidence?: number | null;
};

export function getContentPresentationLabel(
  item: RankedFeedItem,
  minimumConfidence = 0.75,
): string | null {
  const confidence = Number(item.content_label_confidence ?? 0);
  if (item.content_label !== 'learning' || confidence < minimumConfidence) return null;
  return 'Learning';
}

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

export function isReplacementEligibleNativeDecision(
  decision: NativeCardDecision,
): boolean {
  return decision.action === 'hide'
    && decision.reason !== 'source_filter';
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

export function keepOutermostElements<T>(
  elements: T[],
  contains: (parent: T, child: T) => boolean,
): T[] {
  return elements.filter((element, index) => !elements.some(
    (candidate, candidateIndex) => candidateIndex !== index
      && contains(candidate, element),
  ));
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

function seededCandidateOrder(seed: string, id: string): number {
  const value = `${seed}|${id}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getReplacementCandidates(
  items: RankedFeedItem[],
  blockedIds: Iterable<string | undefined>,
  limit = 6,
  minimumScore = 52,
  selectionSeed = '',
): RankedFeedItem[] {
  const blocked = new Set(Array.from(blockedIds).filter((id): id is string => Boolean(id && id.trim())));
  const seen = new Set<string>();

  return items.filter((item) => {
    const id = item.external_id?.trim();
    if (
      !id
      || !item.title
      || !item.traceId
      || blocked.has(id)
      || seen.has(id)
      || item.visible === false
      || item.suppressed === true
      || (item.policyOutcome != null && item.policyOutcome !== 'eligible')
      || (item.score ?? 0) < minimumScore
    ) {
      return false;
    }
    seen.add(id);
    return true;
  })
    .sort((left, right) => {
      const leftScore = left.score ?? 0;
      const rightScore = right.score ?? 0;
      const leftBand = Math.floor(leftScore / 5);
      const rightBand = Math.floor(rightScore / 5);
      if (rightBand !== leftBand || !selectionSeed) return rightScore - leftScore;
      const seeded = seededCandidateOrder(selectionSeed, left.external_id ?? '')
        - seededCandidateOrder(selectionSeed, right.external_id ?? '');
      return seeded || rightScore - leftScore;
    })
    .slice(0, limit);
}

export type OpportunisticReplacementAssignment = {
  target: OpportunisticReplacementTarget;
  item: RankedFeedItem;
};
export function isRetrievedDiscoveryCandidate(item: RankedFeedItem): boolean {
  const mechanisms = [
    item.provenance?.mechanism,
    ...(item.acquisition_history ?? []).map((entry) => entry.mechanism),
  ];
  return mechanisms.some((mechanism) => mechanism === 'web_search' || mechanism === 'rss');
}

export function selectRetrievedDiscoveryAssignments(
  nativeTargets: OpportunisticReplacementTarget[],
  replacementCandidates: RankedFeedItem[],
  limit = 2,
): OpportunisticReplacementAssignment[] {
  const candidates = replacementCandidates
    .filter((item) => (
      isRetrievedDiscoveryCandidate(item)
      && Boolean(item.external_id && item.title && item.traceId)
      && item.visible !== false
      && item.suppressed !== true
      && (item.policyOutcome == null || item.policyOutcome === 'eligible')
    ))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

  const targets = [...nativeTargets]
    .filter((target) => target.externalId && !target.externalId.startsWith('title:'))
    .sort((left, right) => left.score - right.score || left.nativeIndex - right.nativeIndex);

  const selected: OpportunisticReplacementAssignment[] = [];
  const count = Math.min(Math.max(0, limit), candidates.length, targets.length);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates[index];
    const target = targets[index];
    if (!candidate || !target || (candidate.score ?? 0) < target.score) continue;
    selected.push({ target, item: candidate });
  }
  return selected;
}


export function selectOpportunisticReplacementAssignments(
  nativeTargets: OpportunisticReplacementTarget[],
  replacementCandidates: RankedFeedItem[],
  limit = 6,
  minimumUplift = 5,
): OpportunisticReplacementAssignment[] {
  const candidates = replacementCandidates
    .filter((item) => (
      Boolean(item.external_id && item.title && item.traceId)
      && item.visible !== false
      && item.suppressed !== true
      && (item.policyOutcome == null || item.policyOutcome === 'eligible')
    ))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

  const targets = [...nativeTargets]
    .filter((target) => target.externalId && !target.externalId.startsWith('title:'))
    .sort((left, right) => left.score - right.score || left.nativeIndex - right.nativeIndex);

  const selected: OpportunisticReplacementAssignment[] = [];
  const count = Math.min(Math.max(0, limit), candidates.length, targets.length);
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates[index];
    const target = targets[index];
    const candidateScore = candidate?.score ?? 0;
    if (!candidate || !target || candidateScore < target.score + Math.max(0, minimumUplift)) break;
    selected.push({ target, item: candidate });
  }
  return selected;
}

export type OpportunisticReplacementTarget = {
  externalId: string;
  score: number;
  nativeIndex: number;
};

export function selectOpportunisticReplacementTargets(
  nativeTargets: OpportunisticReplacementTarget[],
  replacementCandidates: RankedFeedItem[],
  limit = 6,
  minimumUplift = 5,
): OpportunisticReplacementTarget[] {
  return selectOpportunisticReplacementAssignments(
    nativeTargets,
    replacementCandidates,
    limit,
    minimumUplift,
  ).map((assignment) => assignment.target);
}

export type ReplacementSlot = {
  slotId: string;
  sourceVideoId: string;
};

export function createReplacementSlotId(
  generation: number,
  routeKey: string,
  nativeIndex: number,
  sourceVideoId: string,
): string {
  return `${generation}|${routeKey}|${nativeIndex}|${sourceVideoId}`;
}

export type ReplacementAssignment = {
  slot: ReplacementSlot;
  item: RankedFeedItem;
};

export function getReplacementTextMetadata(item: RankedFeedItem): {
  title: string;
  creator: string;
  displayScore: number;
  rawScore: number | null;
} {
  return {
    title: item.title?.trim() || 'Recommended video',
    creator: item.channel_name?.trim() || 'Unknown creator',
    displayScore: Number.isFinite(item.score) ? Number(item.score) : 0,
    rawScore: Number.isFinite(item.rawScore) ? Number(item.rawScore) : null,
  };
}

export type ReplacementPresentationMetadata = {
  generation: number;
  mode: string;
  score: number;
  traceId: string;
  slotId: string;
  sourceVideoId: string;
  replacementVideoId: string;
};

export function getReplacementPresentationMetadata(
  assignment: ReplacementAssignment,
  generation: number,
  mode: string,
): ReplacementPresentationMetadata {
  return {
    generation,
    mode,
    score: assignment.item.score ?? 0,
    traceId: assignment.item.traceId ?? '',
    slotId: assignment.slot.slotId,
    sourceVideoId: assignment.slot.sourceVideoId,
    replacementVideoId: assignment.item.external_id ?? '',
  };
}

export function planReplacementAssignments(
  items: RankedFeedItem[],
  slots: ReplacementSlot[],
  blockedIds: Iterable<string | undefined>,
  minimumScore = 52,
  selectionSeed = '',
): ReplacementAssignment[] {
  const stableSlots = slots.filter((slot, index) => (
    Boolean(slot.slotId && slot.sourceVideoId && !slot.sourceVideoId.startsWith('title:'))
    && slots.findIndex((candidate) => candidate.slotId === slot.slotId) === index
  ));
  const blocked = [
    ...Array.from(blockedIds),
    ...stableSlots.map((slot) => slot.sourceVideoId),
  ];
  const candidates = getReplacementCandidates(
    items,
    blocked,
    stableSlots.length,
    minimumScore,
    selectionSeed,
  );
  return stableSlots.slice(0, candidates.length).map((slot, index) => ({
    slot,
    item: candidates[index],
  }));
}

export function isRenderGenerationStale(requestGeneration: number, latestGeneration: number): boolean {
  return requestGeneration !== latestGeneration;
}

export function getSourceShelfHideReason(
  input: { heading?: string; hasShortsLink?: boolean; hasPlayableLink?: boolean },
  filters: { includeShorts?: boolean; includePlayables?: boolean },
): 'shorts' | 'playables' | null {
  const heading = (input.heading ?? '').trim().toLowerCase();
  if (filters.includeShorts === false && input.hasShortsLink === true) return 'shorts';
  if (
    filters.includePlayables === false
    && (input.hasPlayableLink === true || heading.includes('playables'))
  ) return 'playables';
  return null;
}

export function shouldHideForSourceFilters(
  source: { is_short?: boolean; is_live?: boolean },
  filters: { includeShorts?: boolean; includeLive?: boolean },
): boolean {
  return (source.is_short === true && filters.includeShorts === false)
    || (source.is_live === true && filters.includeLive === false);
}
