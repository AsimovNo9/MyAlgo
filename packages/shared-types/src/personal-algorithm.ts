import type { ContentIdentity, NormalizedEvidence } from './evidence';

export const PERSONAL_ALGORITHM_SCHEMA_VERSION = 1 as const;

export type EvidenceRetentionPolicy = 'default' | 'until_expiry' | 'indefinite';

export type EvidenceRecord = {
  id: string;
  evidence: NormalizedEvidence;
  confidence: number;
  retainedAt: string;
  retention: {
    policy: EvidenceRetentionPolicy;
    expiresAt: string | null;
  };
};

export type GraphNodeKind = 'content' | 'creator' | 'concept' | 'topic' | 'user' | 'objective';

export type GraphProvenance = 'explicit' | 'inferred';

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  label: string;
  content?: ContentIdentity | null;
  provenance: GraphProvenance;
  confidence: number | null;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type GraphEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: string;
  provenance: GraphProvenance;
  confidence: number | null;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UserGraphEdit = {
  id: string;
  action: 'create_node' | 'update_node' | 'delete_node' | 'create_edge' | 'update_edge' | 'delete_edge';
  targetId: string;
  before: unknown | null;
  after: unknown | null;
  createdAt: string;
};

export type GraphRevision = {
  id: string;
  revision: number;
  reason: string;
  createdAt: string;
};

export type PersonalAlgorithmGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  userEdits: UserGraphEdit[];
  revisions: GraphRevision[];
  currentRevision: number;
};

export type PersonalAlgorithmState = {
  schemaVersion: typeof PERSONAL_ALGORITHM_SCHEMA_VERSION;
  evidence: EvidenceRecord[];
  graph: PersonalAlgorithmGraph;
};

export const createEmptyGraph = (): PersonalAlgorithmGraph => ({
  nodes: [],
  edges: [],
  userEdits: [],
  revisions: [],
  currentRevision: 0,
});
