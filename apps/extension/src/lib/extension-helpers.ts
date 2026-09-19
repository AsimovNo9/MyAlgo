import type { FeedItem, FeedResponse } from '@repo/shared-types';

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
};

// Summarizes which sources and topics are actually driving the visible feed,
// so the popup can show "why this feed looks the way it does" without another API call.
export function summarizeFeed(items: FeedItem[]): FeedSummary {
  let subscribedCount = 0;
  let discoveredCount = 0;
  const topicCounts = new Map<string, number>();

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
  }

  const topTopics = [...topicCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));

  return { subscribedCount, discoveredCount, topTopics };
}
