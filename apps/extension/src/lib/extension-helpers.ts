import type { DurableSemanticModeCatalog, FeedItem, FeedResponse, SemanticCategoryId } from '@repo/shared-types';

export function normalizeFeed(feed: FeedResponse): FeedItem[] {
  return (feed.items ?? []).map((item) => ({
    ...item,
    visible: item.visible ?? true,
    matched_topics: item.matched_topics ?? [],
  }));
}

export function scoreToVisibility(score: number): 'visible' | 'hidden' | 'highlighted' {
  if (score >= 85) return 'highlighted';
  if (score >= 50) return 'visible';
  return 'hidden';
}

export type FeedSummary = {
  subscribedCount: number;
  discoveredCount: number;
  topTopics: Array<{ topic: string; count: number }>;
  categories: Array<{ category: SemanticCategoryId; count: number }>;
};

// Summarizes which sources and topics are actually driving the visible feed,
// so the popup can show "why this feed looks the way it does" without another API call.
export function summarizeFeed(items: FeedItem[]): FeedSummary {
  let subscribedCount = 0;
  let discoveredCount = 0;
  const topicCounts = new Map<string, number>();
  const categoryStats = new Map<string, {
    category: SemanticCategoryId;
    count: number;
    hardCount: number;
    strength: number;
  }>();

  for (const item of items) {
    if (item.visible === false) continue;

    if (item.source_kind === 'discovery') {
      discoveredCount += 1;
    } else if (item.source_kind === 'subscription') {
      subscribedCount += 1;
    }

    for (const topic of item.matched_topics ?? []) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
    // Per-video badges stay conservative, but mode discovery uses the model's
    // broader soft category scores across the visible feed. This lets recurring
    // graph concepts become modes even when individual candidates are too close
    // to call confidently.
    const itemCategoryScores = new Map<string, { category: SemanticCategoryId; score: number; hard: boolean }>();
    for (const [category, rawScore] of Object.entries(item.semantic_category_scores ?? {})) {
      const score = Number(rawScore ?? 0);
      const label = category.trim();
      if (!label || !Number.isFinite(score) || score < 0.22) continue;
      itemCategoryScores.set(label.toLowerCase(), {
        category: label,
        score: Math.min(1, Math.max(0, score)),
        hard: false,
      });
    }

    const semanticConfidence = Number(item.semantic_category_confidence ?? 0);
    if (item.semantic_category && semanticConfidence >= 0.35) {
      const label = item.semantic_category.trim();
      const key = label.toLowerCase();
      const previous = itemCategoryScores.get(key);
      itemCategoryScores.set(key, {
        category: label,
        score: Math.max(previous?.score ?? 0, Math.min(1, semanticConfidence)),
        hard: true,
      });
    }

    for (const entry of itemCategoryScores.values()) {
      const key = entry.category.toLowerCase();
      const previous = categoryStats.get(key);
      categoryStats.set(key, {
        category: previous?.category ?? entry.category,
        count: (previous?.count ?? 0) + 1,
        hardCount: (previous?.hardCount ?? 0) + Number(entry.hard),
        strength: (previous?.strength ?? 0) + entry.score,
      });
    }
  }

  const topTopics = [...topicCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));

  const categoryValues = [...categoryStats.values()];
  const repeated = categoryValues.filter((entry) => entry.count >= 2 || entry.hardCount > 0);
  const candidates = repeated.length > 0 ? repeated : categoryValues;
  const categories = candidates
    .sort((left, right) => (
      right.hardCount - left.hardCount
      || right.strength - left.strength
      || right.count - left.count
      || left.category.localeCompare(right.category)
    ))
    .slice(0, 8)
    .map(({ category, count }) => ({ category, count }));
  return { subscribedCount, discoveredCount, topTopics, categories };
}


export type DurableModeOption = {
  id: string;
  label: string;
  revision: number | null;
  active: boolean;
};

export function buildDurableModeOptions(
  currentModeId: string,
  catalog: DurableSemanticModeCatalog | null | undefined,
  currentModeLabel = 'Default',
  limit = 12,
): DurableModeOption[] {
  const result: DurableModeOption[] = [{
    id: 'default',
    label: 'All',
    revision: null,
    active: true,
  }];
  const seen = new Set(['default']);
  const modes = [...(catalog?.modes ?? [])]
    .sort((left, right) => (
      Number(right.active) - Number(left.active)
      || Number(right.pinned) - Number(left.pinned)
      || right.lastSupportedAt.localeCompare(left.lastSupportedAt)
      || left.id.localeCompare(right.id)
    ));

  for (const mode of modes) {
    if (result.length >= limit + 1) break;
    if (!mode.id.trim() || seen.has(mode.id)) continue;
    result.push({
      id: mode.id,
      label: mode.label,
      revision: mode.revision,
      active: mode.active,
    });
    seen.add(mode.id);
  }

  const currentId = currentModeId.trim() || 'default';
  if (!seen.has(currentId)) {
    const current = modes.find((mode) => mode.id === currentId);
    if (current) {
      result.push({
        id: current.id,
        label: current.label,
        revision: current.revision,
        active: current.active,
      });
    } else if (currentId !== 'default') {
      result.push({
        id: currentId,
        label: currentModeLabel.trim() || currentId,
        revision: null,
        active: false,
      });
    }
  }

  return result;
}
