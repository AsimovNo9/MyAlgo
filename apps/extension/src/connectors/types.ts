import type {
  ContentIdentity,
  ContentMetadata,
  EvidenceConnector,
  ExposureEvidence,
  InteractionEvidence,
  InteractionKind,
  RecommendationCandidate,
  RecommendationQueryPlan,
} from '@repo/shared-types';

export type WebSearchRequest = {
  query: string;
  lane: RecommendationQueryPlan['lane'];
  topics: string[];
  graphRevision: string;
  acquiredAt: string;
  limit: number;
};

export interface WebSearchProvider {
  readonly id: string;
  search(request: WebSearchRequest): Promise<RecommendationCandidate[]>;
}

export type ProviderEnrichmentInput = {
  external_id: string;
  title: string;
  channel_name?: string | null;
  channel_id?: string | null;
  thumbnail_url?: string | null;
  description?: string | null;
  duration_seconds?: number | null;
  published_at?: string | null;
  topics?: string[];
  content_type?: string | null;
  is_short?: boolean;
  is_live?: boolean;
};

export type ProviderTranscriptEnrichment = {
  text: string;
  language: string;
  source: 'youtube_caption_track';
  auto_generated: boolean;
};

export type ProviderEnrichmentResult = ProviderEnrichmentInput & {
  view_count?: number | null;
  transcript?: ProviderTranscriptEnrichment | null;
};

export type ProviderAcquisitionConnector = {
  readonly search?: WebSearchProvider;
  enrich(candidate: ProviderEnrichmentInput): Promise<ProviderEnrichmentResult | null>;
};

export type ProviderCapabilities = {
  search: boolean;
  activity: boolean;
  subscriptions: boolean;
  writeActions: boolean;
  publicContent: boolean;
  userContent: boolean;
};

export type ProviderPresentationContract = {
  candidateLimit: number;
  minimumVisibleScore: number;
  replacementMinimumScore: number;
  replacementMinimumUplift: number;
  replacementLimit: number;
  shelfBatchSize: number;
  shelfDomLimit: number;
  horizontalAspectRatio: `${number} / ${number}`;
  verticalAspectRatio: `${number} / ${number}`;
};

export interface PageProviderConnector extends EvidenceConnector {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  readonly pageUrlPatterns: readonly string[];
  readonly sync?: {
    alarmName: string;
    path: string;
    periodMinutes: number;
    initialDelayMinutes: number;
  };
  readonly cardSelectors: readonly string[];
  readonly titleSelectors: readonly string[];
  readonly videoLinkSelector: string;
  readonly presentation: ProviderPresentationContract;
  readonly acquisition?: ProviderAcquisitionConnector;
  canHandleUrl(href: string): boolean;
  getExternalId(href: string): string | undefined;
  getCanonicalUrl(externalId: string): string;
  getSourceFlags(href: string): { is_short: boolean; is_live: boolean };
  normalizeText(value: string): string;
  getLinkTitle(attributes: { title?: string | null; ariaLabel?: string | null; textContent?: string | null }): string;
  mapPresentationEvent(event: 'opened' | 'revisited'): 'opened' | 'revisited';
  identifyContent(externalId: string): ContentIdentity;
  normalizeMetadata(input: {
    title?: string | null;
    creatorId?: string | null;
    creatorName?: string | null;
    description?: string | null;
    durationSeconds?: number | null;
    publishedAt?: string | null;
    language?: string | null;
    format?: string | null;
    contentType?: string | null;
    thumbnailUrl?: string | null;
  }): ContentMetadata;
  createExposure(input: {
    exposureId: string;
    externalId: string;
    surface: string;
    section?: string | null;
    position?: number | null;
    observedAt: string;
    mechanism: string;
    metadata?: ContentMetadata | null;
  }): ExposureEvidence;
  createInteraction(input: {
    externalId: string;
    exposureId?: string | null;
    interaction: InteractionKind;
    observedAt: string;
    mechanism: string;
    sessionId?: string | null;
    metrics?: Record<string, number>;
    metadata?: ContentMetadata | null;
  }): InteractionEvidence;
}
