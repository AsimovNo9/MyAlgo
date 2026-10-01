import type { ContentIdentity, NormalizedEvidence } from './evidence';

export const PERSONAL_ALGORITHM_SCHEMA_VERSION = 3 as const;

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

export type ForgottenEvidenceRecord = {
  evidenceId: string;
  deletedAt: string;
  reason: 'forgotten';
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
  evidenceIds: string[];
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type GraphControlAction = 'reduce' | 'prefer' | 'mute';
export type GraphControlTargetKind = 'node' | 'edge';

export type GraphControl = {
  id: string;
  targetKind: GraphControlTargetKind;
  targetId: string;
  action: GraphControlAction;
  createdAt: string;
  updatedAt: string;
};

export type GraphEditBaseline = {
  revision: number;
  capturedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  controls: GraphControl[];
};

export type UserGraphEdit = {
  id: string;
  action:
    | 'create_node'
    | 'update_node'
    | 'delete_node'
    | 'create_edge'
    | 'update_edge'
    | 'delete_edge'
    | 'set_control'
    | 'remove_control'
    | 'undo'
    | 'restore_original';
  targetId: string;
  before: unknown | null;
  after: unknown | null;
  revertsEditId?: string | null;
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
  /**
   * Explicit user correction overlays. Optional for pre-v3 persisted-state compatibility;
   * the local store normalizes missing arrays to [].
   */
  controls?: GraphControl[];
  /**
   * Immutable snapshot captured immediately before the first user graph
   * mutation. Evidence is intentionally excluded so Restore original never
   * deletes retained evidence.
   */
  originalBaseline?: GraphEditBaseline | null;
};

export type PersonalAlgorithmState = {
  schemaVersion: typeof PERSONAL_ALGORITHM_SCHEMA_VERSION;
  evidence: EvidenceRecord[];
  forgottenEvidence: ForgottenEvidenceRecord[];
  graph: PersonalAlgorithmGraph;
};

export const createEmptyGraph = (): PersonalAlgorithmGraph => ({
  nodes: [],
  edges: [],
  userEdits: [],
  revisions: [],
  currentRevision: 0,
  controls: [],
  originalBaseline: null,
});
