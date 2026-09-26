import type {
  EvidenceRecord,
  EvidenceRetentionPolicy,
  GraphEdge,
  GraphNode,
  PersonalAlgorithmGraph,
  PersonalAlgorithmState,
  UserGraphEdit,
} from '@repo/shared-types';
import type { ContentMetadata, NormalizedEvidence } from '@repo/shared-types';

export type LocalStateStorage = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
};

export type EvidenceInput = {
  evidence: NormalizedEvidence;
  confidence?: number;
  retentionPolicy?: EvidenceRetentionPolicy;
  expiresAt?: string | null;
};

export type GraphReview = {
  schemaVersion: number;
  evidenceCount: number;
  nodeCount: number;
  edgeCount: number;
  nodesByKind: Record<string, number>;
  edgesByRelation: Record<string, number>;
  inferredEdgeCount: number;
  inferredEdgesWithSupport: number;
  inferredEdgesWithoutSupport: number;
  evidenceBackedEdgeCount: number;
  unsupportedEdgeIds: string[];
};

const DEFAULT_STATE_KEY = 'personal-algorithm-state';
const PERSONAL_ALGORITHM_SCHEMA_VERSION = 2 as const;
const LEGACY_PERSONAL_ALGORITHM_SCHEMA_VERSION = 1 as const;

const nowIso = () => new Date().toISOString();

const clampConfidence = (value: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const makeId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const contentNodeId = (source: string, externalId: string) =>
  `content:${encodeURIComponent(source)}:${encodeURIComponent(externalId)}`;

const CONTENT_METADATA_KEYS: (keyof ContentMetadata)[] = [
  'title',
  'creatorId',
  'creatorName',
  'description',
  'durationSeconds',
  'publishedAt',
  'language',
  'format',
  'contentType',
];

const getContentMetadata = (attributes: Record<string, unknown>): ContentMetadata | null => {
  const metadata = attributes.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  return metadata as ContentMetadata;
};

const mergeContentMetadata = (
  existing: ContentMetadata | null,
  incoming: ContentMetadata,
): ContentMetadata => {
  const merged: Partial<ContentMetadata> = { ...(existing ?? {}) };
  for (const key of CONTENT_METADATA_KEYS) {
    const value = incoming[key];
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '')) {
      merged[key] = value as never;
    }
  }
  if (!merged.title) merged.title = incoming.title;
  return merged as ContentMetadata;
};

const createEmptyState = (): PersonalAlgorithmState => ({
  schemaVersion: PERSONAL_ALGORITHM_SCHEMA_VERSION,
  evidence: [],
  graph: {
    nodes: [],
    edges: [],
    userEdits: [],
    revisions: [],
    currentRevision: 0,
  },
});

const migrateState = (raw: unknown): PersonalAlgorithmState => {
  if (!raw || typeof raw !== 'object') return createEmptyState();
  const candidate = raw as Partial<PersonalAlgorithmState>;
  const rawVersion = (raw as { schemaVersion?: number }).schemaVersion;

  if (rawVersion === PERSONAL_ALGORITHM_SCHEMA_VERSION
      && Array.isArray(candidate.evidence)
      && candidate.graph
      && Array.isArray(candidate.graph.nodes)
      && Array.isArray(candidate.graph.edges)
      && Array.isArray(candidate.graph.userEdits)
      && Array.isArray(candidate.graph.revisions)
      && Number.isInteger(candidate.graph.currentRevision)) {
    return {
      schemaVersion: PERSONAL_ALGORITHM_SCHEMA_VERSION,
      evidence: candidate.evidence,
      graph: {
        ...candidate.graph,
        edges: candidate.graph.edges.map((edge) => ({
          ...edge,
          evidenceIds: Array.isArray((edge as GraphEdge).evidenceIds)
            ? [...new Set((edge as GraphEdge).evidenceIds.filter((id) => typeof id === 'string' && id.length > 0))]
            : [],
        })),
      },
    };
  }

  if (rawVersion === LEGACY_PERSONAL_ALGORITHM_SCHEMA_VERSION
      && Array.isArray(candidate.evidence)
      && candidate.graph
      && Array.isArray(candidate.graph.nodes)
      && Array.isArray(candidate.graph.edges)
      && Array.isArray(candidate.graph.userEdits)
      && Array.isArray(candidate.graph.revisions)
      && Number.isInteger(candidate.graph.currentRevision)) {
    return {
      schemaVersion: PERSONAL_ALGORITHM_SCHEMA_VERSION,
      evidence: candidate.evidence,
      graph: {
        ...candidate.graph,
        edges: candidate.graph.edges.map((edge) => ({
          ...edge,
          evidenceIds: [],
        })),
      },
    };
  }

  // Unknown or malformed versions are intentionally not guessed into the graph.
  return createEmptyState();
};

export class LocalPersonalAlgorithmStore {
  private readonly storage: LocalStateStorage;
  private readonly key: string;
  private state: PersonalAlgorithmState | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storage: LocalStateStorage, key = DEFAULT_STATE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  async initialize(): Promise<void> {
    if (this.state) return;
    const result = await this.storage.get([this.key]);
    this.state = migrateState(result[this.key]);
    const rawVersion = (result[this.key] as { schemaVersion?: number } | undefined)?.schemaVersion;
    if (result[this.key] == null || rawVersion !== PERSONAL_ALGORITHM_SCHEMA_VERSION) {
      await this.persist();
    }
  }

  private async getState(): Promise<PersonalAlgorithmState> {
    await this.initialize();
    return this.state as PersonalAlgorithmState;
  }

  private async persist(): Promise<void> {
    const snapshot = structuredClone(this.state);
    this.writeQueue = this.writeQueue.then(() => this.storage.set({ [this.key]: snapshot }));
    await this.writeQueue;
  }

  private async mutate<T>(fn: (state: PersonalAlgorithmState) => T): Promise<T> {
    const state = await this.getState();
    const result = fn(state);
    await this.persist();
    return result;
  }

  async listEvidence(): Promise<EvidenceRecord[]> {
    const state = await this.getState();
    return structuredClone(state.evidence);
  }

  async getEvidence(id: string): Promise<EvidenceRecord | null> {
    const state = await this.getState();
    const record = state.evidence.find((item) => item.id === id);
    return record ? structuredClone(record) : null;
  }

  async upsertEvidence(input: EvidenceInput, id = makeId('evidence')): Promise<EvidenceRecord> {
    return this.mutate((state) => {
      const record: EvidenceRecord = {
        id,
        evidence: structuredClone(input.evidence),
        confidence: clampConfidence(input.confidence ?? 1),
        retainedAt: nowIso(),
        retention: {
          policy: input.retentionPolicy ?? 'default',
          expiresAt: input.expiresAt ?? null,
        },
      };
      const index = state.evidence.findIndex((item) => item.id === id);
      if (index >= 0) {
        state.evidence[index] = record;
        this.removeCreatorRelationshipSupport(state, record.id);
      } else {
        state.evidence.push(record);
      }
      this.ensureContentNode(state, record.evidence);
      this.ensureCreatorRelationship(state, record.evidence, record.id, record.confidence);
      return structuredClone(record);
    });
  }

  async reconcileHistoryEvidence(inputs: Array<{ id: string; evidence: NormalizedEvidence; confidence?: number; retentionPolicy?: EvidenceRetentionPolicy; expiresAt?: string | null }>): Promise<{ removed: number; upserted: number }> {
    return this.mutate((state) => {
      const historyIds = new Set(
        state.evidence
          .filter((record) => (
            record.evidence.kind === 'interaction'
            && record.evidence.interaction === 'watched'
            && record.evidence.provenance.mechanism === 'history_dom'
          ))
          .map((record) => record.id),
      );

      if (historyIds.size > 0) {
        state.evidence = state.evidence.filter((record) => !historyIds.has(record.id));
        state.graph.edges = state.graph.edges
          .map((edge) => ({
            ...edge,
            evidenceIds: edge.evidenceIds.filter((evidenceId) => !historyIds.has(evidenceId)),
          }))
          .filter((edge) => edge.provenance !== 'inferred' || edge.evidenceIds.length > 0);
      }

      const retainedAt = nowIso();
      for (const input of inputs) {
        const record: EvidenceRecord = {
          id: input.id,
          evidence: structuredClone(input.evidence),
          confidence: clampConfidence(input.confidence ?? 1),
          retainedAt,
          retention: {
            policy: input.retentionPolicy ?? 'default',
            expiresAt: input.expiresAt ?? null,
          },
        };
        const existingIndex = state.evidence.findIndex((item) => item.id === record.id);
        if (existingIndex >= 0) state.evidence[existingIndex] = record;
        else state.evidence.push(record);
        this.ensureContentNode(state, record.evidence);
        this.ensureCreatorRelationship(state, record.evidence, record.id, record.confidence);
      }

      return { removed: historyIds.size, upserted: inputs.length };
    });
  }

  async deleteEvidence(id: string): Promise<boolean> {
    return this.mutate((state) => {
      const before = state.evidence.length;
      state.evidence = state.evidence.filter((item) => item.id !== id);
      if (state.evidence.length === before) return false;

      state.graph.edges = state.graph.edges
        .map((edge) => ({ ...edge, evidenceIds: edge.evidenceIds.filter((evidenceId) => evidenceId !== id) }))
        .filter((edge) => edge.provenance !== 'inferred' || edge.evidenceIds.length > 0);

      return true;
    });
  }

  async deleteEvidenceForContent(source: string, externalId: string): Promise<number> {
    return this.mutate((state) => {
      const removedIds = new Set(
        state.evidence
          .filter((item) => item.evidence.content.source === source && item.evidence.content.externalId === externalId)
          .map((item) => item.id),
      );
      if (removedIds.size === 0) return 0;

      state.evidence = state.evidence.filter((item) => !removedIds.has(item.id));
      state.graph.edges = state.graph.edges
        .map((edge) => ({
          ...edge,
          evidenceIds: edge.evidenceIds.filter((evidenceId) => !removedIds.has(evidenceId)),
        }))
        .filter((edge) => edge.provenance !== 'inferred' || edge.evidenceIds.length > 0);

      return removedIds.size;
    });
  }

  async getGraph(): Promise<PersonalAlgorithmGraph> {
    const state = await this.getState();
    return structuredClone(state.graph);
  }

  async getEvidenceForEdge(edgeId: string): Promise<EvidenceRecord[]> {
    const state = await this.getState();
    const edge = state.graph.edges.find((item) => item.id === edgeId);
    if (!edge) return [];
    const evidenceById = new Map(state.evidence.map((item) => [item.id, item]));
    return edge.evidenceIds
      .map((id) => evidenceById.get(id))
      .filter((record): record is EvidenceRecord => Boolean(record))
      .map((record) => structuredClone(record));
  }

  async upsertNode(node: Omit<GraphNode, 'createdAt' | 'updatedAt'> & Partial<Pick<GraphNode, 'createdAt' | 'updatedAt'>>): Promise<GraphNode> {
    return this.mutate((state) => {
      const timestamp = nowIso();
      const existingIndex = state.graph.nodes.findIndex((item) => item.id === node.id);
      const previous = existingIndex >= 0 ? state.graph.nodes[existingIndex] : null;
      const next: GraphNode = {
        ...node,
        confidence: node.confidence == null ? null : clampConfidence(node.confidence),
        createdAt: previous?.createdAt ?? node.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      if (existingIndex >= 0) state.graph.nodes[existingIndex] = next;
      else state.graph.nodes.push(next);
      this.recordEdit(state, existingIndex >= 0 ? 'update_node' : 'create_node', next.id, previous, next);
      return structuredClone(next);
    });
  }

  async deleteNode(id: string): Promise<boolean> {
    return this.mutate((state) => {
      const node = state.graph.nodes.find((item) => item.id === id);
      if (!node) return false;
      state.graph.nodes = state.graph.nodes.filter((item) => item.id !== id);
      const removedEdges = state.graph.edges.filter(
        (edge) => edge.sourceNodeId === id || edge.targetNodeId === id,
      );
      state.graph.edges = state.graph.edges.filter(
        (edge) => edge.sourceNodeId !== id && edge.targetNodeId !== id,
      );
      this.recordEdit(state, 'delete_node', id, { node, removedEdges }, null);
      return true;
    });
  }

  async upsertEdge(edge: Omit<GraphEdge, 'createdAt' | 'updatedAt'> & Partial<Pick<GraphEdge, 'createdAt' | 'updatedAt'>>): Promise<GraphEdge> {
    return this.mutate((state) => {
      const evidenceIds = [...new Set(edge.evidenceIds.filter((id) => typeof id === 'string' && id.length > 0))];
      if (edge.provenance === 'inferred' && evidenceIds.length === 0) {
        throw new Error('Inferred graph edges must reference supporting evidence');
      }

      const missingEvidenceIds = evidenceIds.filter((id) => !state.evidence.some((record) => record.id === id));
      if (missingEvidenceIds.length > 0) {
        throw new Error(`Graph edge references unknown evidence: ${missingEvidenceIds.join(', ')}`);
      }

      const timestamp = nowIso();
      const existingIndex = state.graph.edges.findIndex((item) => item.id === edge.id);
      const previous = existingIndex >= 0 ? state.graph.edges[existingIndex] : null;
      const next: GraphEdge = {
        ...edge,
        evidenceIds,
        confidence: edge.confidence == null ? null : clampConfidence(edge.confidence),
        createdAt: previous?.createdAt ?? edge.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      if (existingIndex >= 0) state.graph.edges[existingIndex] = next;
      else state.graph.edges.push(next);
      this.recordEdit(state, existingIndex >= 0 ? 'update_edge' : 'create_edge', next.id, previous, next);
      return structuredClone(next);
    });
  }

  async deleteEdge(id: string): Promise<boolean> {
    return this.mutate((state) => {
      const edge = state.graph.edges.find((item) => item.id === id);
      if (!edge) return false;
      state.graph.edges = state.graph.edges.filter((item) => item.id !== id);
      this.recordEdit(state, 'delete_edge', id, edge, null);
      return true;
    });
  }

  async reset(): Promise<void> {
    await this.getState();
    this.state = createEmptyState();
    await this.persist();
  }

  async exportState(): Promise<PersonalAlgorithmState> {
    const state = await this.getState();
    return structuredClone(state);
  }

  async exportStateJson(pretty = true): Promise<string> {
    const state = await this.exportState();
    return JSON.stringify(state, null, pretty ? 2 : 0);
  }

  async reviewGraph(): Promise<GraphReview> {
    const state = await this.getState();
    const nodesByKind: Record<string, number> = {};
    for (const node of state.graph.nodes) {
      nodesByKind[node.kind] = (nodesByKind[node.kind] ?? 0) + 1;
    }

    const edgesByRelation: Record<string, number> = {};
    const evidenceIds = new Set(state.evidence.map((record) => record.id));
    const inferredEdges = state.graph.edges.filter((edge) => edge.provenance === 'inferred');
    const supportedInferredEdges = inferredEdges.filter((edge) => edge.evidenceIds.some((id) => evidenceIds.has(id)));
    const unsupportedEdgeIds = inferredEdges
      .filter((edge) => !edge.evidenceIds.some((id) => evidenceIds.has(id)))
      .map((edge) => edge.id)
      .sort();

    for (const edge of state.graph.edges) {
      edgesByRelation[edge.relation] = (edgesByRelation[edge.relation] ?? 0) + 1;
    }

    return {
      schemaVersion: state.schemaVersion,
      evidenceCount: state.evidence.length,
      nodeCount: state.graph.nodes.length,
      edgeCount: state.graph.edges.length,
      nodesByKind,
      edgesByRelation,
      inferredEdgeCount: inferredEdges.length,
      inferredEdgesWithSupport: supportedInferredEdges.length,
      inferredEdgesWithoutSupport: unsupportedEdgeIds.length,
      evidenceBackedEdgeCount: state.graph.edges.filter((edge) => edge.evidenceIds.length > 0).length,
      unsupportedEdgeIds,
    };
  }

  async rebuildGraphFromEvidence(): Promise<PersonalAlgorithmGraph> {
    return this.mutate((state) => {
      state.graph.edges = state.graph.edges.filter(
        (edge) => !(edge.provenance === 'inferred' && edge.relation === 'created_by'),
      );
      state.graph.nodes = state.graph.nodes.filter(
        (node) => !(node.provenance === 'inferred' && node.kind === 'creator'),
      );

      const records = [...state.evidence].sort((a, b) =>
        a.evidence.observedAt.localeCompare(b.evidence.observedAt) || a.id.localeCompare(b.id),
      );

      for (const record of records) {
        this.ensureContentNode(state, record.evidence);
        this.ensureCreatorRelationship(state, record.evidence, record.id, record.confidence);
      }

      return structuredClone(state.graph);
    });
  }

  private ensureContentNode(state: PersonalAlgorithmState, evidence: NormalizedEvidence): void {
    const identity = evidence.content;
    const id = contentNodeId(identity.source, identity.externalId);
    const existing = state.graph.nodes.find((node) => node.id === id);

    if (existing) {
      if (existing.kind !== 'content') return;
      const metadata = evidence.metadata ?? null;
      if (!metadata) return;
      const mergedMetadata = mergeContentMetadata(
        getContentMetadata(existing.attributes),
        metadata,
      );
      const nextTitle = mergedMetadata?.title?.trim();
      if (nextTitle && existing.label === identity.externalId) existing.label = nextTitle;
      if (mergedMetadata) existing.attributes = { ...existing.attributes, metadata: mergedMetadata };
      existing.updatedAt = nowIso();
      return;
    }

    const metadata = evidence.metadata ?? null;
    const title = metadata?.title?.trim();
    const timestamp = nowIso();
    state.graph.nodes.push({
      id,
      kind: 'content',
      label: title || identity.externalId,
      content: identity,
      provenance: 'explicit',
      confidence: null,
      attributes: metadata ? { metadata } : {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private removeCreatorRelationshipSupport(state: PersonalAlgorithmState, evidenceId: string): void {
    state.graph.edges = state.graph.edges
      .map((edge) => edge.relation === 'created_by' && edge.provenance === 'inferred'
        ? { ...edge, evidenceIds: edge.evidenceIds.filter((id) => id !== evidenceId) }
        : edge)
      .filter((edge) => edge.relation !== 'created_by' || edge.provenance !== 'inferred' || edge.evidenceIds.length > 0);
  }

  private ensureCreatorRelationship(
    state: PersonalAlgorithmState,
    evidence: NormalizedEvidence,
    evidenceId: string,
    confidence: number,
  ): void {
    const metadata = evidence.metadata;
    const creatorKey = metadata?.creatorId ?? metadata?.creatorName;
    if (!creatorKey) return;

    const contentId = contentNodeId(evidence.content.source, evidence.content.externalId);
    const creatorNodeId = `creator:${encodeURIComponent(evidence.content.source)}:${encodeURIComponent(creatorKey)}`;
    const creatorLabel = metadata?.creatorName ?? creatorKey;
    const creatorNode = state.graph.nodes.find((node) => node.id === creatorNodeId);

    if (!creatorNode) {
      const timestamp = nowIso();
      state.graph.nodes.push({
        id: creatorNodeId,
        kind: 'creator',
        label: creatorLabel,
        provenance: 'inferred',
        confidence,
        attributes: { source: evidence.content.source },
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    const edgeId = `edge:created_by:${contentId}:${creatorNodeId}`;
    const existingEdge = state.graph.edges.find((edge) => edge.id === edgeId);
    if (existingEdge) {
      existingEdge.evidenceIds = [...new Set([...existingEdge.evidenceIds, evidenceId])];
      existingEdge.updatedAt = nowIso();
      return;
    }

    const timestamp = nowIso();
    state.graph.edges.push({
      id: edgeId,
      sourceNodeId: contentId,
      targetNodeId: creatorNodeId,
      relation: 'created_by',
      provenance: 'inferred',
      confidence,
      evidenceIds: [evidenceId],
      attributes: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private recordEdit(
    state: PersonalAlgorithmState,
    action: UserGraphEdit['action'],
    targetId: string,
    before: unknown,
    after: unknown,
  ): void {
    const timestamp = nowIso();
    state.graph.currentRevision += 1;
    state.graph.revisions.push({
      id: makeId('revision'),
      revision: state.graph.currentRevision,
      reason: `graph_${action}`,
      createdAt: timestamp,
    });
    state.graph.userEdits.push({
      id: makeId('edit'),
      action,
      targetId,
      before: structuredClone(before),
      after: structuredClone(after),
      createdAt: timestamp,
    });
  }
}

export const createChromeLocalStateStorage = (): LocalStateStorage => ({
  get: (keys) => chrome.storage.local.get(keys) as Promise<Record<string, unknown>>,
  set: (values) => chrome.storage.local.set(values),
  remove: (keys) => chrome.storage.local.remove(keys),
});
