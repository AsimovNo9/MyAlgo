import type { CandidateAcquisitionProvenance, RecommendationCandidate, RecommendationQueryPlan, RetrievalDiagnostics } from '@repo/shared-types';
import type { WebSearchProvider, WebSearchRequest } from '../connectors/types';

export const RSS_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

const normalizePlanTopic = (value: string): string => (
  value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
);

export function selectWebSearchPlans(
  plans: readonly RecommendationQueryPlan[],
  maxPlans = 4,
  priorityTopics: readonly string[] = [],
): RecommendationQueryPlan[] {
  const limit = Math.max(0, Math.floor(maxPlans));
  if (limit === 0) return [];

  const selected: RecommendationQueryPlan[] = [];
  const selectedIndexes = new Set<number>();
  const add = (index: number) => {
    if (index < 0 || selected.length >= limit || selectedIndexes.has(index)) return;
    selected.push(plans[index]);
    selectedIndexes.add(index);
  };

  const goalIndex = plans.findIndex((plan) => plan.lane === 'goal');
  add(goalIndex);

  const normalizedPriorities = [...new Set(
    priorityTopics.map(normalizePlanTopic).filter(Boolean),
  )];

  for (const priority of normalizedPriorities) {
    const index = plans.findIndex((plan, planIndex) => (
      !selectedIndexes.has(planIndex)
      && plan.lane !== 'goal'
      && plan.topics.some((topic) => normalizePlanTopic(topic) === priority)
    ));
    add(index);
  }

  if (selected.length < limit && normalizedPriorities.length > 0) {
    for (let index = 0; index < plans.length && selected.length < limit; index += 1) {
      if (selectedIndexes.has(index) || plans[index].lane === 'goal') continue;
      const matchesPriority = plans[index].topics.some((topic) => (
        normalizedPriorities.includes(normalizePlanTopic(topic))
      ));
      if (matchesPriority) add(index);
    }
  }

  for (let index = 0; index < plans.length && selected.length < limit; index += 1) {
    add(index);
  }

  return selected;
}

export function reconcileModeSupplyForSelection(
  diagnostics: RetrievalDiagnostics,
  activeModeId: string | null | undefined,
  activeModeRevision: number | null | undefined,
): RetrievalDiagnostics {
  const modeId = activeModeId?.trim() ?? '';
  const supply = diagnostics.modeSupply ?? null;
  const keepSupply = Boolean(
    supply
    && modeId
    && modeId !== 'default'
    && Number.isInteger(activeModeRevision)
    && supply.modeId === modeId
    && supply.modeRevision === activeModeRevision
  );
  if (keepSupply || supply == null) return diagnostics;
  return {
    ...diagnostics,
    modeSupply: null,
  };
}
export async function acquireWebSearchCandidates(
  provider: WebSearchProvider,
  plans: RecommendationQueryPlan[],
  acquiredAt: string,
  maxPlans = 4,
  perPlanLimit = 8,
): Promise<RecommendationCandidate[]> {
  const selectedPlans = plans.slice(0, Math.max(0, maxPlans));
  const batches = await Promise.all(selectedPlans.map((plan) =>
    provider.search(buildWebSearchRequest(plan, acquiredAt, perPlanLimit)),
  ));

  const byId = new Map<string, RecommendationCandidate>();
  for (const candidate of batches.flat()) {
    if (!byId.has(candidate.external_id)) byId.set(candidate.external_id, candidate);
  }
  return [...byId.values()];
}

export function buildWebSearchRequest(
  plan: RecommendationQueryPlan,
  acquiredAt: string,
  limit = 8,
): WebSearchRequest {
  return {
    query: plan.text,
    lane: plan.lane,
    topics: [...plan.topics],
    graphRevision: plan.algorithmRevision,
    acquiredAt,
    limit: Math.max(1, Math.min(20, Math.floor(limit))),
  };
}

export function mergeCandidateAcquisitionHistory(
  existing: CandidateAcquisitionProvenance[] | undefined,
  incoming: CandidateAcquisitionProvenance,
  limit = 12,
): CandidateAcquisitionProvenance[] {
  const key = (item: CandidateAcquisitionProvenance) => JSON.stringify([
    item.connector,
    item.mechanism,
    item.query ?? null,
    item.query_lane ?? null,
    item.graph_revision ?? null,
    item.source_url ?? null,
  ]);
  const byKey = new Map<string, CandidateAcquisitionProvenance>();
  for (const item of [...(existing ?? []), incoming]) {
    const identity = key(item);
    const previous = byKey.get(identity);
    if (!previous || previous.acquired_at.localeCompare(item.acquired_at) < 0) {
      byKey.set(identity, item);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => right.acquired_at.localeCompare(left.acquired_at))
    .slice(0, Math.max(1, limit));
}

export function shouldRefreshObservedCandidate(
  lastSeenAt: string | null | undefined,
  nowMs: number,
  intervalMs = 30_000,
): boolean {
  const previous = new Date(lastSeenAt ?? 0).getTime();
  return !Number.isFinite(previous) || nowMs - previous >= Math.max(0, intervalMs);
}

export const WEB_SEARCH_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
export const WEB_SEARCH_BLOCKED_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function nextWebSearchAllowedAt(
  nowMs: number,
  consecutiveFailures: number,
  providerBlocked = false,
): string {
  if (providerBlocked) {
    return new Date(nowMs + WEB_SEARCH_BLOCKED_COOLDOWN_MS).toISOString();
  }
  if (consecutiveFailures <= 0) {
    return new Date(nowMs + WEB_SEARCH_REFRESH_INTERVAL_MS).toISOString();
  }
  const backoff = Math.min(
    60 * 60 * 1000,
    2 * 60 * 1000 * (2 ** Math.min(4, consecutiveFailures - 1)),
  );
  return new Date(nowMs + backoff).toISOString();
}

export function nextRssAllowedAt(
  nowMs: number,
  consecutiveFailures: number,
): string {
  if (consecutiveFailures <= 0) {
    return new Date(nowMs + RSS_REFRESH_INTERVAL_MS).toISOString();
  }
  const backoff = Math.min(
    60 * 60 * 1000,
    5 * 60 * 1000 * (2 ** Math.min(4, consecutiveFailures - 1)),
  );
  return new Date(nowMs + backoff).toISOString();
}

export function isRetrievalAllowed(nextAllowedAt: string | null | undefined, nowMs: number): boolean {
  if (!nextAllowedAt) return true;
  const timestamp = new Date(nextAllowedAt).getTime();
  return !Number.isFinite(timestamp) || timestamp <= nowMs;
}
