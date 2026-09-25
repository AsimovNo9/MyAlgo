export type AlgorithmMode = 'Work' | 'Learning' | 'Relax';

export type RuleType = 'always_show' | 'never_show' | 'priority';

export type FeedbackEventType = 'not_interested' | 'more_like_this' | 'never_show_channel';

export type ActivityEventType = 'opened' | 'watch_progress' | 'completed' | 'skipped' | 'revisited';

export interface TopicWeight {
  topic: string;
  weight: number;
}

export interface Rule {
  id?: string;
  type: RuleType;
  condition_text: string;
  created_at?: string;
}

export interface Algorithm {
  id?: string;
  name: string;
  is_active?: boolean;
  goal_text?: string | null;
  language?: string | null;
  preferred_formats?: string[];
  created_at?: string;
  topic_weights?: TopicWeight[];
  rules?: Rule[];
  semantic_terms?: string[] | null;
}

export interface FeedItem {
  id: string;
  title: string;
  channel_name?: string | null;
  channel_id?: string | null;
  thumbnail_url?: string | null;
  external_id: string;
  score: number;
  visible: boolean;
  reason?: string;
  matched_topics?: string[];
  semantic_path?: Array<{
    concept: string;
    relation_type: string | null;
    confidence: number;
  }>;
  source_kind?: 'subscription' | 'discovery' | 'liked' | null;
  lane?: 'matched' | 'discovery' | 'explore';
}

export interface FeedResponse {
  items: FeedItem[];
  algorithmId?: string;
  generatedAt: string;
}

export interface FeedSourceFilters {
  subscribedOnly?: boolean;
  includeDiscovery?: boolean;
  includeShorts?: boolean;
  includeLive?: boolean;
}

export interface AlgorithmPayload {
  id?: string;
  name: string;
  is_active?: boolean;
  goal_text?: string | null;
  language?: string | null;
  preferred_formats?: string[];
  topic_weights: TopicWeight[];
  rules: Rule[];
}

export interface AlgorithmActivationResponse {
  ok: boolean;
  tier: 0 | 1 | 2;
  poolCount: number;
  rss: unknown;
  coldStart: unknown;
  error?: string;
}

export interface ClassifyRequest {
  contentItemId: string;
  title: string;
  channelName?: string | null;
}

export interface ClassifyResponse {
  id: string;
  topics: string[];
  content_type?: string | null;
  language?: string | null;
  format?: string | null;
  confidence?: number | null;
  quality_score?: number | null;
  reasoning?: string | null;
}

export interface FeedbackRequest {
  contentItemId: string;
  eventType: FeedbackEventType;
}

export interface ActivityRequest {
  externalId: string;
  eventType: ActivityEventType;
  watchSeconds?: number;
  occurredAt?: string;
}

export interface ExtensionMessage<T = unknown> {
  type: string;
  payload?: T;
}

export interface ApiErrorResponse {
  error: string;
}

export type SemanticRelationType =
  | 'parent_of'
  | 'child_of'
  | 'related_to'
  | 'alias_of'
  | 'example_of'
  | 'contrasts_with'
  | 'often_cooccurs_with'
  | 'format_for';

export type SemanticSource = 'curated' | 'platform' | 'user' | 'content' | 'llm';

export interface SemanticConcept {
  id: string;
  canonical_name: string;
  description?: string | null;
  aliases: string[];
  intents: string[];
  entities: string[];
  positive_phrases: string[];
  negative_phrases: string[];
  language: string | null;
  source: SemanticSource;
  version: number;
}

export interface SemanticConceptRelation {
  source_concept_id: string;
  target_concept_id: string;
  relation_type: SemanticRelationType;
  weight: number;
  source: SemanticSource;
  version: number;
}

export interface SemanticConceptMatch {
  concept_id: string;
  confidence: number;
  similarity?: number | null;
  source: 'deterministic' | 'graph' | 'embedding' | 'llm';
  model_version?: string | null;
}

export interface ContentFacet {
  language?: string | null;
  region?: string | null;
  format?: string | null;
  content_type?: string | null;
  category?: string | null;
  creator_id?: string | null;
  entities?: string[];
  concepts?: SemanticConceptMatch[];
}

export interface RetrievalProvenance {
  source: 'youtube_subscription' | 'youtube_search' | 'youtube_rss' | 'youtube_liked' | 'semantic_vector';
  query?: string | null;
  query_lane?: 'goal' | 'topic' | 'alias' | 'format' | 'intent' | 'creator' | 'freshness' | null;
  query_topics?: string[];
  retrieved_at: string;
  algorithm_revision?: string | null;
}

export interface SemanticProfile {
  canonical_topics: string[];
  positive_concepts: string[];
  negative_concepts: string[];
  preferred_formats: string[];
  preferred_entities: string[];
  preferred_creators: string[];
  language: string | null;
  revision: string;
}

export interface EmbeddingRecord {
  owner_type: 'concept' | 'content' | 'user_profile';
  owner_id: string;
  model_version: string;
  dimensions: number;
  embedding: number[];
  generated_at: string;
}

export type CandidateRetrievalSource = 'youtube_subscription' | 'youtube_search' | 'youtube_rss' | 'youtube_liked' | 'semantic_vector';

export type CandidateQueryLane = 'goal' | 'topic' | 'alias' | 'format' | 'intent' | 'creator' | 'freshness';

export interface CandidateProvenance extends RetrievalProvenance {
  source: CandidateRetrievalSource;
  query_lane?: CandidateQueryLane | null;
  channel_id?: string | null;
}

export interface RecommendationCandidate {
  id?: string;
  external_id: string;
  title: string;
  channel_name?: string | null;
  channel_id?: string | null;
  channel_description?: string | null;
  channel_subscriber_count?: number | null;
  description?: string | null;
  thumbnail_url?: string | null;
  source_kind?: 'subscription' | 'discovery' | 'liked' | null;
  published_at?: string | null;
  topics?: string[];
  facets?: ContentFacet;
  content_type?: string | null;
  language?: string | null;
  format?: string | null;
  provenance?: CandidateProvenance;
  is_short?: boolean;
  is_live?: boolean;
  subscription_affinity?: number;
  candidate_relevance?: 'matched' | 'unmatched';
  base_score?: number;
  semantic_similarity?: number | null;
}

export type RecommendationQueryLane = 'goal' | 'topic' | 'alias' | 'format' | 'intent' | 'creator' | 'freshness';

export interface RecommendationQuery {
  text: string;
  lane: RecommendationQueryLane;
  topics: string[];
}

export interface RecommendationQueryPlan extends RecommendationQuery {
  algorithmRevision: string;
}

export interface RecommendationProfile {
  goal: string;
  language: string | null;
  explicitTopics: string[];
  aliases: string[];
  intents: string[];
  semanticTerms: string[];
  positiveRuleTerms: string[];
  negativeRuleTerms: string[];
  preferredFormats: string[];
  creatorTerms: string[];
}

export function normalizeSemanticKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeSemanticList(values: string[] | null | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeSemanticKey).filter(Boolean))];
}

export function clampSemanticConfidence(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function normalizeSemanticConceptMatch(match: SemanticConceptMatch): SemanticConceptMatch {
  return {
    ...match,
    concept_id: normalizeSemanticKey(match.concept_id),
    confidence: clampSemanticConfidence(match.confidence),
    similarity: match.similarity == null ? null : clampSemanticConfidence(match.similarity),
  };
}

export type { ContentIdentity, ContentMetadata, EvidenceConnector, EvidenceProvenance, ExposureEvidence, InteractionEvidence, InteractionKind, NormalizedEvidence } from './evidence';
