export type CandidateRetrievalSource = 'youtube_subscription' | 'youtube_search' | 'youtube_rss';

export type CandidateProvenance = {
  source: CandidateRetrievalSource;
  query?: string | null;
  channel_id?: string | null;
  retrieved_at: string;
};

export type RecommendationCandidate = {
  id: string;
  external_id: string;
  title: string;
  channel_name: string;
  channel_id?: string | null;
  channel_description?: string | null;
  channel_subscriber_count?: number | null;
  description?: string | null;
  published_at?: string | null;
  source_kind: 'subscription' | 'discovery';
  topics?: string[];
  provenance?: CandidateProvenance;
};

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

export function createCandidateProvenance(
  source: CandidateRetrievalSource,
  details: Omit<Partial<CandidateProvenance>, 'source' | 'retrieved_at'> & { retrievedAt?: string } = {},
): CandidateProvenance {
  return {
    source,
    query: details.query ?? null,
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

export function buildCandidateRawMetadata(candidate: Pick<RecommendationCandidate, 'description' | 'provenance'>): Record<string, unknown> {
  return {
    description: candidate.description ?? null,
    retrieval: candidate.provenance ?? null,
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