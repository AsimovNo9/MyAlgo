import type {
  CandidateProvenance,
  CandidateQueryLane,
  CandidateRetrievalSource,
  RecommendationCandidate,
} from '@repo/shared-types';

export type { CandidateProvenance, CandidateQueryLane, CandidateRetrievalSource, RecommendationCandidate } from '@repo/shared-types';

export type RssCandidateInput = {
  videoId: string;
  title: string;
  channelName: string | null;
  description: string | null;
  publishedAt: string | null;
  provenance?: CandidateProvenance;
};

export type ClassifiedCandidateRow = {
  classifications?:
    | { topics?: string[] | null }
    | Array<{ topics?: string[] | null }>
    | null;
};

export type TopicCoverage = Record<string, number>;

export function createCandidateProvenance(
  source: CandidateRetrievalSource,
  details: Omit<Partial<CandidateProvenance>, 'source' | 'retrieved_at'> & { retrievedAt?: string } = {},
): CandidateProvenance {
  return {
    source,
    query: details.query ?? null,
    query_lane: details.query_lane ?? null,
    query_topics: details.query_topics ?? [],
    channel_id: details.channel_id ?? null,
    retrieved_at: details.retrievedAt ?? new Date().toISOString(),
  };
}

export function normalizeRssCandidate(item: RssCandidateInput, channelId: string): RecommendationCandidate {
  return {
    id: item.videoId,
    external_id: item.videoId,
    title: item.title,
    channel_name: item.channelName ?? 'Unknown channel',
    channel_id: channelId,
    description: item.description,
    published_at: item.publishedAt,
    source_kind: 'discovery',
    provenance: item.provenance ?? createCandidateProvenance('youtube_rss', { channel_id: channelId }),
  };
}

export function buildCandidateRawMetadata(candidate: Pick<RecommendationCandidate, 'description' | 'provenance'> & { metadata?: Record<string, unknown> }): Record<string, unknown> {
  return {
    description: candidate.description ?? null,
    retrieval: candidate.provenance ?? null,
    ...(candidate.metadata ? { metadata: candidate.metadata } : {}),
  };
}

export function hasSufficientSharedTopicPool(
  rows: ClassifiedCandidateRow[],
  topics: string[],
  minimum = 15,
): boolean {
  if (topics.length === 0 || minimum <= 0) {
    return false;
  }

  const normalizedTopics = new Set(topics.map((topic) => topic.trim().toLowerCase()).filter(Boolean));
  const matchingRows = rows.filter((row) => {
    const classification = Array.isArray(row.classifications) ? row.classifications[0] : row.classifications;
    return (classification?.topics ?? []).some((topic) => normalizedTopics.has(topic.toLowerCase()));
  });

  return matchingRows.length >= minimum;
}

export function getTopicCoverage(rows: ClassifiedCandidateRow[], topics: string[]): TopicCoverage {
  const coverage: TopicCoverage = Object.fromEntries(
    topics.map((topic) => topic.trim().toLowerCase()).filter(Boolean).map((topic) => [topic, 0]),
  );

  for (const row of rows) {
    const classification = Array.isArray(row.classifications) ? row.classifications[0] : row.classifications;
    const rowTopics = new Set((classification?.topics ?? []).map((topic) => topic.toLowerCase()));
    for (const topic of Object.keys(coverage)) {
      if (rowTopics.has(topic)) coverage[topic] += 1;
    }
  }

  return coverage;
}

export function hasSufficientTopicCoverage(
  rows: ClassifiedCandidateRow[],
  topics: string[],
  minimumPerTopic = 5,
): boolean {
  if (topics.length === 0 || minimumPerTopic <= 0) return false;
  const coverage = getTopicCoverage(rows, topics);
  return Object.values(coverage).every((count) => count >= minimumPerTopic);
}

export function summarizeActivationCoverage(
  rows: ClassifiedCandidateRow[],
  topics: string[],
  minimumPerTopic = 5,
) {
  return {
    poolCount: rows.length,
    topicCoverage: getTopicCoverage(rows, topics),
    sufficient: hasSufficientTopicCoverage(rows, topics, minimumPerTopic),
  };
}