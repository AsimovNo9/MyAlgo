import type { CandidateRetrievalSource } from './candidates.ts';

export type CandidatePoolItem = {
  external_id: string;
  topics?: string[];
  provenance?: { source?: CandidateRetrievalSource | null } | null;
  source_kind?: 'subscription' | 'discovery' | 'liked' | null;
};

export type CandidateSourceBatch<T extends CandidatePoolItem> = {
  source: CandidateRetrievalSource;
  items: T[];
};

export type CandidatePoolMetrics = {
  inputCount: number;
  uniqueCount: number;
  duplicateCount: number;
  sourceCounts: Record<CandidateRetrievalSource, number>;
  topicCoverage: Record<string, number>;
};

export type CandidatePoolResult<T extends CandidatePoolItem> = {
  items: T[];
  metrics: CandidatePoolMetrics;
};

function emptySourceCounts(): Record<CandidateRetrievalSource, number> {
  return {
    youtube_subscription: 0,
    youtube_search: 0,
    youtube_rss: 0,
    youtube_liked: 0,
    semantic_vector: 0,
  };
}

export function assembleCandidatePool<T extends CandidatePoolItem>(
  batches: CandidateSourceBatch<T>[],
  requiredTopics: string[] = [],
): CandidatePoolResult<T> {
  const sourceCounts = emptySourceCounts();
  const uniqueItems = new Map<string, T>();
  let inputCount = 0;

  for (const batch of batches) {
    for (const item of batch.items) {
      inputCount += 1;
      const source = item.provenance?.source ?? batch.source;
      sourceCounts[source] += 1;
      if (!uniqueItems.has(item.external_id)) {
        uniqueItems.set(item.external_id, item);
      }
    }
  }

  const topicCoverage = Object.fromEntries(
    requiredTopics
      .map((topic) => topic.trim().toLowerCase())
      .filter(Boolean)
      .map((topic) => [topic, 0]),
  );

  for (const item of uniqueItems.values()) {
    const itemTopics = new Set((item.topics ?? []).map((topic) => topic.trim().toLowerCase()));
    for (const topic of Object.keys(topicCoverage)) {
      if (itemTopics.has(topic)) {
        topicCoverage[topic] += 1;
      }
    }
  }

  return {
    items: [...uniqueItems.values()],
    metrics: {
      inputCount,
      uniqueCount: uniqueItems.size,
      duplicateCount: inputCount - uniqueItems.size,
      sourceCounts,
      topicCoverage,
    },
  };
}
