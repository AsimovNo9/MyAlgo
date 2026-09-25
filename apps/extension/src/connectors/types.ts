import type {
  ContentIdentity,
  ContentMetadata,
  EvidenceConnector,
  ExposureEvidence,
  InteractionEvidence,
  InteractionKind,
} from '@repo/shared-types';

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
