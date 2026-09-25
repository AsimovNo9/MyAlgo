export type EvidenceSourceId = string;

export type ContentIdentity = {
  source: EvidenceSourceId;
  externalId: string;
};

export type EvidenceProvenance = {
  connector: EvidenceSourceId;
  mechanism: string;
};

export type ContentMetadata = {
  title: string;
  creatorId?: string | null;
  creatorName?: string | null;
  description?: string | null;
  durationSeconds?: number | null;
  publishedAt?: string | null;
  language?: string | null;
  format?: string | null;
  contentType?: string | null;
};

export type ExposureEvidence = {
  kind: 'exposure';
  exposureId: string;
  content: ContentIdentity;
  surface: string;
  section?: string | null;
  position?: number | null;
  observedAt: string;
  provenance: EvidenceProvenance;
  metadata?: ContentMetadata | null;
};

export type InteractionKind =
  | 'clicked'
  | 'watched'
  | 'saved'
  | 'shared'
  | 'dismissed'
  | 'feedback';

export type InteractionEvidence = {
  kind: 'interaction';
  content: ContentIdentity;
  exposureId: string | null;
  interaction: InteractionKind;
  observedAt: string;
  provenance: EvidenceProvenance;
  sessionId?: string | null;
  metrics?: Record<string, number>;
  metadata?: ContentMetadata | null;
};

export type NormalizedEvidence = ExposureEvidence | InteractionEvidence;

export type EvidenceConnector = {
  readonly source: EvidenceSourceId;
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
  }): InteractionEvidence;
};
