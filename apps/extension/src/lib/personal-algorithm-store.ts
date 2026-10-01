import type {
  EvidenceRecord,
  EvidenceRetentionPolicy,
  GraphControl,
  GraphControlAction,
  GraphControlTargetKind,
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

export type DerivedGraphProjectionInput = {
  marker: string;
  nodes: Array<Omit<GraphNode, 'createdAt' | 'updatedAt'>>;
  edges: Array<Omit<GraphEdge, 'createdAt' | 'updatedAt'>>;
};

export type DerivedGraphProjectionResult = {
  changed: boolean;
  graphRevision: number;
  nodeCount: number;
  edgeCount: number;
  preservedReferencedNodeCount: number;
};

export type GraphReview = {
  schemaVersion: number;
  evidenceCount: number;
  forgottenEvidenceCount: number;
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
const PERSONAL_ALGORITHM_SCHEMA_VERSION = 3 as const;
const PREVIOUS_PERSONAL_ALGORITHM_SCHEMA_VERSION = 2 as const;
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
  'thumbnailUrl',
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
  forgottenEvidence: [],
  graph: {
    nodes: [],
    edges: [],
    userEdits: [],
    revisions: [],
    currentRevision: 0,
    controls: [],
    originalBaseline: null,
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
      forgottenEvidence: Array.isArray(candidate.forgottenEvidence)
        ? candidate.forgottenEvidence
          .filter((entry) => (
            entry
            && typeof entry.evidenceId === 'string'
            && entry.evidenceId.length > 0
            && typeof entry.deletedAt === 'string'
          ))
          .map((entry) => ({
            evidenceId: entry.evidenceId,
            deletedAt: entry.deletedAt,
            reason: 'forgotten' as const,
          }))
        : [],
      graph: {
        ...candidate.graph,
        edges: candidate.graph.edges.map((edge) => ({
          ...edge,
          evidenceIds: Array.isArray((edge as GraphEdge).evidenceIds)
            ? [...new Set((edge as GraphEdge).evidenceIds.filter((id) => typeof id === 'string' && id.length > 0))]
            : [],
        })),
        controls: Array.isArray(candidate.graph.controls)
          ? candidate.graph.controls.map((control) => structuredClone(control))
          : [],
        originalBaseline: candidate.graph.originalBaseline
          ? structuredClone(candidate.graph.originalBaseline)
          : null,
      },
    };
  }

  if (rawVersion === PREVIOUS_PERSONAL_ALGORITHM_SCHEMA_VERSION
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
      forgottenEvidence: [],
      graph: {
        ...candidate.graph,
        edges: candidate.graph.edges.map((edge) => ({
          ...edge,
          evidenceIds: Array.isArray((edge as GraphEdge).evidenceIds)
            ? [...new Set((edge as GraphEdge).evidenceIds.filter((id) => typeof id === 'string' && id.length > 0))]
            : [],
        })),
        controls: Array.isArray(candidate.graph.controls)
          ? candidate.graph.controls.map((control) => structuredClone(control))
          : [],
        originalBaseline: candidate.graph.originalBaseline
          ? structuredClone(candidate.graph.originalBaseline)
          : null,
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
      forgottenEvidence: [],
      graph: {
        ...candidate.graph,
        edges: candidate.graph.edges.map((edge) => ({
          ...edge,
          evidenceIds: [],
        })),
        controls: [],
        originalBaseline: null,
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
  private readSnapshot: PersonalAlgorithmState | null = null;
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
    this.readSnapshot = null;
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

  async upsertEvidence(input: EvidenceInput, id = makeId('evidence')): Promise<EvidenceRecord | null> {
    return this.mutate((state) => {
      if (state.forgottenEvidence.some((entry) => entry.evidenceId === id)) return null;
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
      const forgottenIds = new Set(state.forgottenEvidence.map((entry) => entry.evidenceId));
      let upserted = 0;
      for (const input of inputs) {
        if (forgottenIds.has(input.id)) continue;
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
        upserted += 1;
      }

      return { removed: historyIds.size, upserted };
    });
  }

  async reconcileExposureEvidence(
    inputs: Array<{ id: string; evidence: NormalizedEvidence; confidence?: number }>,
    mechanism = 'home_dom',
  ): Promise<{ removed: number; upserted: number }> {
    return this.mutate((state) => {
      const nextIds = new Set(inputs.map((input) => input.id));
      const removedIds = new Set(
        state.evidence
          .filter((record) => (
            record.evidence.kind === 'exposure'
            && record.evidence.provenance.mechanism === mechanism
            && !nextIds.has(record.id)
          ))
          .map((record) => record.id),
      );

      if (removedIds.size > 0) {
        state.evidence = state.evidence.filter((record) => !removedIds.has(record.id));
        state.graph.edges = state.graph.edges
          .map((edge) => ({
            ...edge,
            evidenceIds: edge.evidenceIds.filter((evidenceId) => !removedIds.has(evidenceId)),
          }))
          .filter((edge) => edge.provenance !== 'inferred' || edge.evidenceIds.length > 0);
      }

      const retainedAt = nowIso();
      const forgottenIds = new Set(state.forgottenEvidence.map((entry) => entry.evidenceId));
      let upserted = 0;
      for (const input of inputs) {
        if (forgottenIds.has(input.id)) continue;
        const record: EvidenceRecord = {
          id: input.id,
          evidence: structuredClone(input.evidence),
          confidence: clampConfidence(input.confidence ?? 1),
          retainedAt,
          retention: { policy: 'default', expiresAt: null },
        };
        const existingIndex = state.evidence.findIndex((item) => item.id === record.id);
        if (existingIndex >= 0) state.evidence[existingIndex] = record;
        else state.evidence.push(record);
        this.ensureContentNode(state, record.evidence);
        this.ensureCreatorRelationship(state, record.evidence, record.id, record.confidence);
        upserted += 1;
      }

      return { removed: removedIds.size, upserted };
    });
  }

  async compactEvidence(maxDefaultRecords: number, at = new Date()): Promise<number> {
    const state = await this.getState();
    const now = at.getTime();
    const defaults = state.evidence
      .filter((record) => record.retention.policy === 'default')
      .sort((left, right) => right.retainedAt.localeCompare(left.retainedAt));
    const keepDefaultIds = new Set(
      defaults.slice(0, Math.max(0, Math.floor(maxDefaultRecords))).map((record) => record.id),
    );

    const removedIds = new Set(
      state.evidence
        .filter((record) => {
          if (record.retention.policy === 'indefinite') return false;
          if (record.retention.policy === 'until_expiry') {
            const expiresAt = new Date(record.retention.expiresAt ?? 0).getTime();
            return Number.isFinite(expiresAt) && expiresAt <= now;
          }
          return !keepDefaultIds.has(record.id);
        })
        .map((record) => record.id),
    );
    if (removedIds.size === 0) return 0;

    state.evidence = state.evidence.filter((record) => !removedIds.has(record.id));
    state.graph.edges = state.graph.edges
      .map((edge) => ({
        ...edge,
        evidenceIds: edge.evidenceIds.filter((evidenceId) => !removedIds.has(evidenceId)),
      }))
      .filter((edge) => edge.provenance !== 'inferred' || edge.evidenceIds.length > 0);

    const evidenceContentIds = new Set(state.evidence.map((record) =>
      contentNodeId(record.evidence.content.source, record.evidence.content.externalId)));
    const edgeNodeIds = new Set(state.graph.edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]));
    const editedNodeIds = new Set(state.graph.userEdits
      .filter((edit) => edit.action.endsWith('_node'))
      .map((edit) => edit.targetId));
    state.graph.nodes = state.graph.nodes.filter((node) => (
      node.kind !== 'content'
      || evidenceContentIds.has(node.id)
      || edgeNodeIds.has(node.id)
      || editedNodeIds.has(node.id)
    ));

    const referencedCreatorIds = new Set(state.graph.edges.map((edge) => edge.targetNodeId));
    state.graph.nodes = state.graph.nodes.filter((node) => (
      node.kind !== 'creator'
      || node.provenance !== 'inferred'
      || referencedCreatorIds.has(node.id)
      || editedNodeIds.has(node.id)
    ));

    await this.persist();
    return removedIds.size;
  }

  async forgetEvidence(id: string): Promise<{
    forgotten: boolean;
    graphRevision: number;
  }> {
    return this.mutate((state) => {
      const record = state.evidence.find((item) => item.id === id);
      if (!record) {
        return {
          forgotten: false,
          graphRevision: state.graph.currentRevision,
        };
      }

      state.evidence = state.evidence.filter((item) => item.id !== id);
      if (!state.forgottenEvidence.some((entry) => entry.evidenceId === id)) {
        state.forgottenEvidence.push({
          evidenceId: id,
          deletedAt: nowIso(),
          reason: 'forgotten',
        });
      }

      this.sanitizeGraphAgainstRetainedEvidence(state);

      state.graph.currentRevision += 1;
      state.graph.revisions.push({
        id: makeId('revision'),
        revision: state.graph.currentRevision,
        reason: `forget_evidence:${id}`,
        createdAt: nowIso(),
      });

      return {
        forgotten: true,
        graphRevision: state.graph.currentRevision,
      };
    });
  }

  async deleteEvidence(id: string): Promise<boolean> {
    const result = await this.forgetEvidence(id);
    return result.forgotten;
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
      this.ensureOriginalBaseline(state);
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
      this.ensureOriginalBaseline(state);
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
      this.ensureOriginalBaseline(state);
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
      this.ensureOriginalBaseline(state);
      state.graph.edges = state.graph.edges.filter((item) => item.id !== id);
      this.recordEdit(state, 'delete_edge', id, edge, null);
      return true;
    });
  }

  async setGraphControl(
    targetKind: GraphControlTargetKind,
    targetId: string,
    action: GraphControlAction,
  ): Promise<GraphControl> {
    return this.mutate((state) => {
      const targetExists = targetKind === 'node'
        ? state.graph.nodes.some((node) => node.id === targetId)
        : state.graph.edges.some((edge) => edge.id === targetId);
      if (!targetExists) throw new Error(`Unknown graph ${targetKind}: ${targetId}`);

      this.ensureOriginalBaseline(state);
      const controls = state.graph.controls ?? (state.graph.controls = []);
      const existingIndex = controls.findIndex((control) => (
        control.targetKind === targetKind && control.targetId === targetId
      ));
      const previous = existingIndex >= 0 ? controls[existingIndex] : null;
      const timestamp = nowIso();
      const next: GraphControl = {
        id: previous?.id ?? `control:${targetKind}:${encodeURIComponent(targetId)}`,
        targetKind,
        targetId,
        action,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      if (existingIndex >= 0) controls[existingIndex] = next;
      else controls.push(next);
      this.recordEdit(state, 'set_control', next.id, previous, next);
      return structuredClone(next);
    });
  }

  async removeGraphControl(
    targetKind: GraphControlTargetKind,
    targetId: string,
  ): Promise<boolean> {
    return this.mutate((state) => {
      const controls = state.graph.controls ?? (state.graph.controls = []);
      const existingIndex = controls.findIndex((control) => (
        control.targetKind === targetKind && control.targetId === targetId
      ));
      if (existingIndex < 0) return false;
      this.ensureOriginalBaseline(state);
      const previous = controls[existingIndex]!;
      controls.splice(existingIndex, 1);
      this.recordEdit(state, 'remove_control', previous.id, previous, null);
      return true;
    });
  }

  async undoLastGraphEdit(): Promise<UserGraphEdit | null> {
    return this.mutate((state) => {
      const revertedIds = new Set(
        state.graph.userEdits
          .filter((edit) => edit.action === 'undo' && edit.revertsEditId)
          .map((edit) => edit.revertsEditId as string),
      );
      const target = [...state.graph.userEdits]
        .reverse()
        .find((edit) => edit.action !== 'undo' && !revertedIds.has(edit.id));
      if (!target) return null;

      if (target.before == null) this.removeCreatedEditState(state, target);
      else this.applyEditState(state, target.before);
      this.sanitizeGraphAgainstRetainedEvidence(state);
      const undo = this.recordEdit(
        state,
        'undo',
        target.targetId,
        target.after,
        target.before,
        target.id,
      );
      return structuredClone(undo);
    });
  }

  async restoreOriginalGraph(): Promise<boolean> {
    return this.mutate((state) => {
      const baseline = state.graph.originalBaseline;
      if (!baseline) return false;
      const before = this.captureEditableGraphState(state);
      state.graph.nodes = structuredClone(baseline.nodes);
      state.graph.edges = structuredClone(baseline.edges);
      state.graph.controls = structuredClone(baseline.controls);
      this.sanitizeGraphAgainstRetainedEvidence(state);
      const after = this.captureEditableGraphState(state);
      this.recordEdit(state, 'restore_original', 'graph', before, after);
      return true;
    });
  }

  async reset(): Promise<void> {
    await this.getState();
    this.state = createEmptyState();
    this.readSnapshot = null;
    await this.persist();
  }

  /**
   * Stable read-only-by-convention snapshot for hot scoring paths. The snapshot
   * is cloned once after each store mutation and then reused until the next
   * mutation. Callers must not mutate the returned object.
   */
  async exportStateForRead(): Promise<PersonalAlgorithmState> {
    const state = await this.getState();
    if (!this.readSnapshot) this.readSnapshot = structuredClone(state);
    return this.readSnapshot;
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
      forgottenEvidenceCount: state.forgottenEvidence.length,
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

  async reconcileDerivedGraphProjection(
    input: DerivedGraphProjectionInput,
  ): Promise<DerivedGraphProjectionResult> {
    return this.mutate((state) => {
      const marker = input.marker.trim();
      if (!marker) throw new Error('Derived graph projection marker is required');

      const ownedNode = (node: GraphNode) => (
        node.provenance === 'inferred' && node.attributes?.derivedBy === marker
      );
      const ownedEdge = (edge: GraphEdge) => (
        edge.provenance === 'inferred' && edge.attributes?.derivedBy === marker
      );

      const evidenceIds = new Set(state.evidence.map((record) => record.id));
      const proposedNodeIds = new Set(input.nodes.map((node) => node.id));
      const proposedEdgeIds = new Set(input.edges.map((edge) => edge.id));
      if (proposedNodeIds.size !== input.nodes.length) {
        throw new Error('Derived graph projection contains duplicate node IDs');
      }
      if (proposedEdgeIds.size !== input.edges.length) {
        throw new Error('Derived graph projection contains duplicate edge IDs');
      }

      const existingNonOwnedNodes = state.graph.nodes.filter((node) => !ownedNode(node));
      const existingNonOwnedEdges = state.graph.edges.filter((edge) => !ownedEdge(edge));
      const nonOwnedNodeIds = new Set(existingNonOwnedNodes.map((node) => node.id));
      const nonOwnedEdgeIds = new Set(existingNonOwnedEdges.map((edge) => edge.id));

      for (const node of input.nodes) {
        if (node.provenance !== 'inferred' || node.attributes?.derivedBy !== marker) {
          throw new Error(`Derived graph node ${node.id} must be owned by ${marker}`);
        }
        if (nonOwnedNodeIds.has(node.id)) {
          throw new Error(`Derived graph node ${node.id} conflicts with non-derived graph state`);
        }
      }

      const availableNodeIds = new Set([
        ...nonOwnedNodeIds,
        ...proposedNodeIds,
      ]);

      for (const edge of input.edges) {
        const normalizedEvidenceIds = [...new Set(edge.evidenceIds)];
        const missingEvidence = normalizedEvidenceIds.filter((id) => !evidenceIds.has(id));
        if (
          edge.provenance !== 'inferred'
          || edge.attributes?.derivedBy !== marker
          || normalizedEvidenceIds.length === 0
          || missingEvidence.length > 0
        ) {
          throw new Error(`Derived graph edge ${edge.id} must be owned by ${marker} and reference retained evidence`);
        }
        if (nonOwnedEdgeIds.has(edge.id)) {
          throw new Error(`Derived graph edge ${edge.id} conflicts with non-derived graph state`);
        }
        if (!availableNodeIds.has(edge.sourceNodeId) || !availableNodeIds.has(edge.targetNodeId)) {
          throw new Error(`Derived graph edge ${edge.id} references a missing graph node`);
        }
      }

      const controlledNodeIds = new Set(
        (state.graph.controls ?? [])
          .filter((control) => control.targetKind === 'node')
          .map((control) => control.targetId),
      );
      const controlledEdgeIds = new Set(
        (state.graph.controls ?? [])
          .filter((control) => control.targetKind === 'edge')
          .map((control) => control.targetId),
      );
      const preservedControlledEdges = state.graph.edges.filter((edge) => (
        ownedEdge(edge)
        && !proposedEdgeIds.has(edge.id)
        && controlledEdgeIds.has(edge.id)
      ));
      const referencedByNonOwnedEdge = new Set([
        ...state.graph.edges
          .filter((edge) => !ownedEdge(edge))
          .flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
        ...preservedControlledEdges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
        ...controlledNodeIds,
      ]);
      const preservedReferencedNodes = state.graph.nodes.filter((node) => (
        ownedNode(node)
        && !proposedNodeIds.has(node.id)
        && referencedByNonOwnedEdge.has(node.id)
      ));

      const timestamp = nowIso();
      const existingNodeById = new Map(state.graph.nodes.map((node) => [node.id, node]));
      const existingEdgeById = new Map(state.graph.edges.map((edge) => [edge.id, edge]));

      const nextOwnedNodes: GraphNode[] = [
        ...input.nodes.map((node) => {
          const previous = existingNodeById.get(node.id);
          const previousComparable = previous ? {
            id: previous.id,
            kind: previous.kind,
            label: previous.label,
            content: previous.content ?? null,
            provenance: previous.provenance,
            confidence: previous.confidence,
            attributes: previous.attributes,
          } : null;
          const nextComparable = { ...node, content: node.content ?? null };
          const unchanged = previousComparable != null
            && JSON.stringify(previousComparable) === JSON.stringify(nextComparable);
          return {
            ...node,
            confidence: node.confidence == null ? null : clampConfidence(node.confidence),
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: unchanged && previous ? previous.updatedAt : timestamp,
          };
        }),
        ...preservedReferencedNodes,
      ].sort((left, right) => left.id.localeCompare(right.id));

      const nextOwnedEdges: GraphEdge[] = [
        ...input.edges
        .map((edge) => {
          const evidenceIdsForEdge = [...new Set(edge.evidenceIds)].sort();
          const previous = existingEdgeById.get(edge.id);
          const previousComparable = previous ? {
            id: previous.id,
            sourceNodeId: previous.sourceNodeId,
            targetNodeId: previous.targetNodeId,
            relation: previous.relation,
            provenance: previous.provenance,
            confidence: previous.confidence,
            evidenceIds: [...new Set(previous.evidenceIds)].sort(),
            attributes: previous.attributes,
          } : null;
          const nextComparable = { ...edge, evidenceIds: evidenceIdsForEdge };
          const unchanged = previousComparable != null
            && JSON.stringify(previousComparable) === JSON.stringify(nextComparable);
          return {
            ...edge,
            evidenceIds: evidenceIdsForEdge,
            confidence: edge.confidence == null ? null : clampConfidence(edge.confidence),
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: unchanged && previous ? previous.updatedAt : timestamp,
          };
        }),
        ...preservedControlledEdges,
      ].sort((left, right) => left.id.localeCompare(right.id));

      const projectionSignature = (nodes: GraphNode[], edges: GraphEdge[]) => JSON.stringify({
        nodes: nodes
          .map((node) => ({
            id: node.id,
            kind: node.kind,
            label: node.label,
            content: node.content ?? null,
            provenance: node.provenance,
            confidence: node.confidence,
            attributes: node.attributes,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        edges: edges
          .map((edge) => ({
            id: edge.id,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            relation: edge.relation,
            provenance: edge.provenance,
            confidence: edge.confidence,
            evidenceIds: [...new Set(edge.evidenceIds)].sort(),
            attributes: edge.attributes,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      });

      const currentOwnedNodes = state.graph.nodes.filter(ownedNode);
      const currentOwnedEdges = state.graph.edges.filter(ownedEdge);
      const changed = projectionSignature(currentOwnedNodes, currentOwnedEdges)
        !== projectionSignature(nextOwnedNodes, nextOwnedEdges);

      if (!changed) {
        return {
          changed: false,
          graphRevision: state.graph.currentRevision,
          nodeCount: currentOwnedNodes.length,
          edgeCount: currentOwnedEdges.length,
          preservedReferencedNodeCount: preservedReferencedNodes.length,
        };
      }

      state.graph.nodes = [...existingNonOwnedNodes, ...nextOwnedNodes];
      state.graph.edges = [
        ...existingNonOwnedEdges,
        ...nextOwnedEdges,
      ];

      state.graph.currentRevision += 1;
      state.graph.revisions.push({
        id: makeId('revision'),
        revision: state.graph.currentRevision,
        reason: `derived_graph_reconcile:${marker}`,
        createdAt: timestamp,
      });

      return {
        changed: true,
        graphRevision: state.graph.currentRevision,
        nodeCount: nextOwnedNodes.length,
        edgeCount: nextOwnedEdges.length,
        preservedReferencedNodeCount: preservedReferencedNodes.length,
      };
    });
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

  private sanitizeGraphAgainstRetainedEvidence(state: PersonalAlgorithmState): void {
    const retainedEvidenceIds = new Set(state.evidence.map((record) => record.id));
    state.graph.edges = state.graph.edges
      .map((edge) => ({
        ...edge,
        evidenceIds: edge.evidenceIds.filter((evidenceId) => retainedEvidenceIds.has(evidenceId)),
      }))
      .filter((edge) => edge.provenance !== 'inferred' || edge.evidenceIds.length > 0);

    const referencedNodeIds = new Set(
      state.graph.edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]),
    );
    const controlledNodeIds = new Set(
      (state.graph.controls ?? [])
        .filter((control) => control.targetKind === 'node')
        .map((control) => control.targetId),
    );
    const editedNodeIds = new Set(
      state.graph.userEdits
        .filter((edit) => edit.action.endsWith('_node'))
        .map((edit) => edit.targetId),
    );
    const retainedContentNodeIds = new Set(
      state.evidence.map((record) => contentNodeId(
        record.evidence.content.source,
        record.evidence.content.externalId,
      )),
    );

    state.graph.nodes = state.graph.nodes.filter((node) => {
      if (node.kind === 'creator' && node.provenance === 'inferred') {
        return referencedNodeIds.has(node.id) || controlledNodeIds.has(node.id) || editedNodeIds.has(node.id);
      }
      if (node.kind === 'content') {
        return retainedContentNodeIds.has(node.id)
          || referencedNodeIds.has(node.id)
          || controlledNodeIds.has(node.id)
          || editedNodeIds.has(node.id);
      }
      return true;
    });

    const availableNodeIds = new Set(state.graph.nodes.map((node) => node.id));
    state.graph.edges = state.graph.edges.filter((edge) => (
      availableNodeIds.has(edge.sourceNodeId) && availableNodeIds.has(edge.targetNodeId)
    ));
    const availableEdgeIds = new Set(state.graph.edges.map((edge) => edge.id));
    state.graph.controls = (state.graph.controls ?? []).filter((control) => (
      control.targetKind === 'node'
        ? availableNodeIds.has(control.targetId)
        : availableEdgeIds.has(control.targetId)
    ));
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

    const referencedNodeIds = new Set(state.graph.edges.map((edge) => edge.targetNodeId));
    state.graph.nodes = state.graph.nodes.filter(
      (node) => node.provenance !== 'inferred'
        || node.kind !== 'creator'
        || referencedNodeIds.has(node.id),
    );
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

  private captureEditableGraphState(state: PersonalAlgorithmState) {
    return {
      nodes: structuredClone(state.graph.nodes),
      edges: structuredClone(state.graph.edges),
      controls: structuredClone(state.graph.controls ?? []),
    };
  }

  private ensureOriginalBaseline(state: PersonalAlgorithmState): void {
    if (state.graph.originalBaseline) return;
    state.graph.originalBaseline = {
      revision: state.graph.currentRevision,
      capturedAt: nowIso(),
      ...this.captureEditableGraphState(state),
    };
  }

  private applyEditState(state: PersonalAlgorithmState, snapshot: unknown): void {
    if (!snapshot || typeof snapshot !== 'object') {
      // Null "before" snapshots correspond to create operations.
      return;
    }
    const value = snapshot as Record<string, unknown>;
    if (Array.isArray(value.nodes) && Array.isArray(value.edges) && Array.isArray(value.controls)) {
      state.graph.nodes = structuredClone(value.nodes as GraphNode[]);
      state.graph.edges = structuredClone(value.edges as GraphEdge[]);
      state.graph.controls = structuredClone(value.controls as GraphControl[]);
      return;
    }

    const control = value as unknown as GraphControl;
    if (
      (control.targetKind === 'node' || control.targetKind === 'edge')
      && typeof control.targetId === 'string'
      && typeof control.id === 'string'
    ) {
      const controls = state.graph.controls ?? (state.graph.controls = []);
      const index = controls.findIndex((entry) => entry.id === control.id);
      if (index >= 0) controls[index] = structuredClone(control);
      else controls.push(structuredClone(control));
      return;
    }

    if ('node' in value && value.node) {
      const node = structuredClone(value.node as GraphNode);
      state.graph.nodes = state.graph.nodes.filter((entry) => entry.id !== node.id);
      state.graph.nodes.push(node);
      for (const edge of structuredClone((value.removedEdges ?? []) as GraphEdge[])) {
        if (!state.graph.edges.some((entry) => entry.id === edge.id)) state.graph.edges.push(edge);
      }
      return;
    }

    const node = value as unknown as GraphNode;
    if (typeof node.id === 'string' && typeof node.kind === 'string' && 'label' in node) {
      const index = state.graph.nodes.findIndex((entry) => entry.id === node.id);
      if (index >= 0) state.graph.nodes[index] = structuredClone(node);
      else state.graph.nodes.push(structuredClone(node));
      return;
    }

    const edge = value as unknown as GraphEdge;
    if (
      typeof edge.id === 'string'
      && typeof edge.sourceNodeId === 'string'
      && typeof edge.targetNodeId === 'string'
    ) {
      const index = state.graph.edges.findIndex((entry) => entry.id === edge.id);
      if (index >= 0) state.graph.edges[index] = structuredClone(edge);
      else state.graph.edges.push(structuredClone(edge));
    }
  }

  private removeCreatedEditState(state: PersonalAlgorithmState, edit: UserGraphEdit): void {
    if (edit.action === 'create_node') {
      state.graph.nodes = state.graph.nodes.filter((node) => node.id !== edit.targetId);
      state.graph.edges = state.graph.edges.filter((edge) => (
        edge.sourceNodeId !== edit.targetId && edge.targetNodeId !== edit.targetId
      ));
    } else if (edit.action === 'create_edge') {
      state.graph.edges = state.graph.edges.filter((edge) => edge.id !== edit.targetId);
    } else if (edit.action === 'set_control' && edit.before == null) {
      state.graph.controls = (state.graph.controls ?? []).filter((control) => control.id !== edit.targetId);
    }
  }

  private recordEdit(
    state: PersonalAlgorithmState,
    action: UserGraphEdit['action'],
    targetId: string,
    before: unknown,
    after: unknown,
    revertsEditId: string | null = null,
  ): UserGraphEdit {
    const timestamp = nowIso();
    state.graph.currentRevision += 1;
    state.graph.revisions.push({
      id: makeId('revision'),
      revision: state.graph.currentRevision,
      reason: `graph_${action}`,
      createdAt: timestamp,
    });
    const edit: UserGraphEdit = {
      id: makeId('edit'),
      action,
      targetId,
      before: structuredClone(before),
      after: structuredClone(after),
      ...(revertsEditId ? { revertsEditId } : {}),
      createdAt: timestamp,
    };
    state.graph.userEdits.push(edit);
    return edit;
  }
}

export const createChromeLocalStateStorage = (): LocalStateStorage => ({
  get: (keys) => chrome.storage.local.get(keys) as Promise<Record<string, unknown>>,
  set: (values) => chrome.storage.local.set(values),
  remove: (keys) => chrome.storage.local.remove(keys),
});
