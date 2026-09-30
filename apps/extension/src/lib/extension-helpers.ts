import type {
  DurableSemanticModeCatalog,
  FeedItem,
  FeedResponse,
  PersonalAlgorithmState,
  SemanticCategoryId,
} from '@repo/shared-types';

export function normalizeFeed(feed: FeedResponse): FeedItem[] {
  return (feed.items ?? []).map((item) => ({
    ...item,
    visible: item.visible ?? true,
    matched_topics: item.matched_topics ?? [],
  }));
}

export function scoreToVisibility(score: number): 'visible' | 'hidden' | 'highlighted' {
  if (score >= 85) return 'highlighted';
  if (score >= 50) return 'visible';
  return 'hidden';
}

export type FeedSummary = {
  subscribedCount: number;
  discoveredCount: number;
  topTopics: Array<{ topic: string; count: number }>;
  categories: Array<{ category: SemanticCategoryId; count: number }>;
};

// Summarizes which sources and topics are actually driving the visible feed,
// so the popup can show "why this feed looks the way it does" without another API call.
export function summarizeFeed(items: FeedItem[]): FeedSummary {
  let subscribedCount = 0;
  let discoveredCount = 0;
  const topicCounts = new Map<string, number>();
  const categoryStats = new Map<string, {
    category: SemanticCategoryId;
    count: number;
    hardCount: number;
    strength: number;
  }>();

  for (const item of items) {
    if (item.visible === false) continue;

    if (item.source_kind === 'discovery') {
      discoveredCount += 1;
    } else if (item.source_kind === 'subscription') {
      subscribedCount += 1;
    }

    for (const topic of item.matched_topics ?? []) {
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
    // Per-video badges stay conservative, but mode discovery uses the model's
    // broader soft category scores across the visible feed. This lets recurring
    // graph concepts become modes even when individual candidates are too close
    // to call confidently.
    const itemCategoryScores = new Map<string, { category: SemanticCategoryId; score: number; hard: boolean }>();
    for (const [category, rawScore] of Object.entries(item.semantic_category_scores ?? {})) {
      const score = Number(rawScore ?? 0);
      const label = category.trim();
      if (!label || !Number.isFinite(score) || score < 0.22) continue;
      itemCategoryScores.set(label.toLowerCase(), {
        category: label,
        score: Math.min(1, Math.max(0, score)),
        hard: false,
      });
    }

    const semanticConfidence = Number(item.semantic_category_confidence ?? 0);
    if (item.semantic_category && semanticConfidence >= 0.35) {
      const label = item.semantic_category.trim();
      const key = label.toLowerCase();
      const previous = itemCategoryScores.get(key);
      itemCategoryScores.set(key, {
        category: label,
        score: Math.max(previous?.score ?? 0, Math.min(1, semanticConfidence)),
        hard: true,
      });
    }

    for (const entry of itemCategoryScores.values()) {
      const key = entry.category.toLowerCase();
      const previous = categoryStats.get(key);
      categoryStats.set(key, {
        category: previous?.category ?? entry.category,
        count: (previous?.count ?? 0) + 1,
        hardCount: (previous?.hardCount ?? 0) + Number(entry.hard),
        strength: (previous?.strength ?? 0) + entry.score,
      });
    }
  }

  const topTopics = [...topicCounts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));

  const categoryValues = [...categoryStats.values()];
  const repeated = categoryValues.filter((entry) => entry.count >= 2 || entry.hardCount > 0);
  const candidates = repeated.length > 0 ? repeated : categoryValues;
  const categories = candidates
    .sort((left, right) => (
      right.hardCount - left.hardCount
      || right.strength - left.strength
      || right.count - left.count
      || left.category.localeCompare(right.category)
    ))
    .slice(0, 8)
    .map(({ category, count }) => ({ category, count }));
  return { subscribedCount, discoveredCount, topTopics, categories };
}


export type DurableModeOption = {
  id: string;
  label: string;
  revision: number | null;
  active: boolean;
};

export function buildDurableModeOptions(
  currentModeId: string,
  catalog: DurableSemanticModeCatalog | null | undefined,
  currentModeLabel = 'Default',
  limit = 12,
): DurableModeOption[] {
  const result: DurableModeOption[] = [{
    id: 'default',
    label: 'All',
    revision: null,
    active: true,
  }];
  const seen = new Set(['default']);
  const modes = [...(catalog?.modes ?? [])]
    .sort((left, right) => (
      Number(right.active) - Number(left.active)
      || Number(right.pinned) - Number(left.pinned)
      || right.lastSupportedAt.localeCompare(left.lastSupportedAt)
      || left.id.localeCompare(right.id)
    ));

  for (const mode of modes) {
    if (result.length >= limit + 1) break;
    if (!mode.id.trim() || seen.has(mode.id)) continue;
    result.push({
      id: mode.id,
      label: mode.label,
      revision: mode.revision,
      active: mode.active,
    });
    seen.add(mode.id);
  }

  const currentId = currentModeId.trim() || 'default';
  if (!seen.has(currentId)) {
    const current = modes.find((mode) => mode.id === currentId);
    if (current) {
      result.push({
        id: current.id,
        label: current.label,
        revision: current.revision,
        active: current.active,
      });
    } else if (currentId !== 'default') {
      result.push({
        id: currentId,
        label: currentModeLabel.trim() || currentId,
        revision: null,
        active: false,
      });
    }
  }

  return result;
}


export type GraphInspectorEvidence = {
  id: string;
  kind: 'exposure' | 'interaction';
  interaction: string | null;
  connector: string;
  mechanism: string;
  observedAt: string;
  contentLabel: string;
};

export type GraphInspectorSemanticContext = {
  externalId: string;
  category: string | null;
  categoryConfidence: number;
  categoryScores?: Record<string, number>;
  graphMatches?: Array<{
    nodeId: string;
    nodeLabel: string;
    similarity: number;
    taxonomyOnly?: boolean;
  }>;
  modeAffinities: Array<{
    modeId: string;
    label: string;
    affinity: number;
  }>;
};

export type GraphInspectorNode = {
  id: string;
  label: string;
  kind: string;
  provenance: 'explicit' | 'inferred';
  confidence: number | null;
  supportCount: number;
  contentSource: string | null;
  contentExternalId: string | null;
  creatorName: string | null;
  thumbnailUrl: string | null;
  semanticClusterId: string | null;
  semanticClusterLabel: string | null;
  semanticClusterKind: 'mode' | 'topic' | null;
  semanticClusterAffinity: number | null;
};

export type GraphInspectorEdge = {
  id: string;
  relation: string;
  provenance: 'explicit' | 'inferred';
  confidence: number | null;
  sourceNodeId: string;
  sourceLabel: string;
  targetNodeId: string;
  targetLabel: string;
  evidenceIds: string[];
  evidence: GraphInspectorEvidence[];
};

export type GraphInspectorView = {
  schemaVersion: number;
  graphRevision: number;
  evidenceCount: number;
  nodeCount: number;
  edgeCount: number;
  nodesByKind: Array<{ key: string; count: number }>;
  edgesByRelation: Array<{ key: string; count: number }>;
  nodes: GraphInspectorNode[];
  edges: GraphInspectorEdge[];
  revisions: Array<{ revision: number; reason: string; createdAt: string }>;
};

const countBy = (values: readonly string[]): Array<{ key: string; count: number }> => (
  [...values.reduce((counts, value) => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  }, new Map<string, number>()).entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }))
);

const isPersonalAlgorithmState = (value: unknown): value is PersonalAlgorithmState => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersonalAlgorithmState>;
  return Number(candidate.schemaVersion) === 2
    && Array.isArray(candidate.evidence)
    && Boolean(candidate.graph)
    && Array.isArray(candidate.graph?.nodes)
    && Array.isArray(candidate.graph?.edges)
    && Array.isArray(candidate.graph?.revisions)
    && Number.isInteger(candidate.graph?.currentRevision);
};

export function buildGraphInspectorView(
  input: unknown,
  semanticContext: readonly GraphInspectorSemanticContext[] = [],
): GraphInspectorView {
  if (!isPersonalAlgorithmState(input)) {
    throw new Error('This is not a valid MyAlgo Personal Algorithm export.');
  }

  const state = input;
  const nodeById = new Map(state.graph.nodes.map((node) => [node.id, node]));
  const evidenceById = new Map(state.evidence.map((record) => [record.id, record]));
  const semanticByExternalId = new Map(
    semanticContext
      .filter((entry) => entry.externalId.trim())
      .map((entry) => [entry.externalId, entry]),
  );
  const supportByNodeId = new Map<string, Set<string>>();

  for (const edge of state.graph.edges) {
    for (const nodeId of [edge.sourceNodeId, edge.targetNodeId]) {
      let support = supportByNodeId.get(nodeId);
      if (!support) {
        support = new Set<string>();
        supportByNodeId.set(nodeId, support);
      }
      for (const evidenceId of edge.evidenceIds) support.add(evidenceId);
    }
  }

  const toEvidence = (evidenceId: string): GraphInspectorEvidence | null => {
    const record = evidenceById.get(evidenceId);
    if (!record) return null;
    const evidence = record.evidence;
    const title = evidence.metadata?.title?.trim();
    const contentLabel = title || evidence.content.externalId;
    return {
      id: record.id,
      kind: evidence.kind,
      interaction: evidence.kind === 'interaction' ? evidence.interaction : null,
      connector: evidence.provenance.connector,
      mechanism: evidence.provenance.mechanism,
      observedAt: evidence.observedAt,
      contentLabel,
    };
  };

  const nodes = state.graph.nodes
    .map((node) => {
      const metadata = node.attributes?.metadata && typeof node.attributes.metadata === 'object'
        ? node.attributes.metadata as {
            creatorName?: string | null;
            thumbnailUrl?: string | null;
          }
        : null;
      return {
        id: node.id,
        label: node.label,
        kind: node.kind,
        provenance: node.provenance,
        confidence: node.confidence,
        supportCount: supportByNodeId.get(node.id)?.size ?? 0,
        contentSource: node.content?.source ?? null,
        contentExternalId: node.content?.externalId ?? null,
        creatorName: metadata?.creatorName ?? null,
        thumbnailUrl: metadata?.thumbnailUrl ?? null,
        ...(() => {
          const semantic = node.content?.externalId
            ? semanticByExternalId.get(node.content.externalId)
            : undefined;
          const strongestGraphMatch = [...(semantic?.graphMatches ?? [])]
            .filter((entry) => (
              !entry.taxonomyOnly
              && entry.nodeLabel.trim()
              && Number.isFinite(entry.similarity)
              && entry.similarity >= 0.35
            ))
            .sort((left, right) => (
              right.similarity - left.similarity
              || left.nodeLabel.localeCompare(right.nodeLabel)
              || left.nodeId.localeCompare(right.nodeId)
            ))[0];
          if (strongestGraphMatch) {
            return {
              semanticClusterId: `topic:${strongestGraphMatch.nodeId}`,
              semanticClusterLabel: strongestGraphMatch.nodeLabel,
              semanticClusterKind: 'topic' as const,
              semanticClusterAffinity: strongestGraphMatch.similarity,
            };
          }

          const strongestCategory = Object.entries(semantic?.categoryScores ?? {})
            .filter(([, score]) => Number.isFinite(score) && score >= 0.22)
            .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]))[0];
          if (strongestCategory) {
            return {
              semanticClusterId: `topic:${strongestCategory[0].toLowerCase()}`,
              semanticClusterLabel: strongestCategory[0],
              semanticClusterKind: 'topic' as const,
              semanticClusterAffinity: Number(strongestCategory[1]),
            };
          }

          const category = semantic?.category?.trim();
          const categoryConfidence = Number(semantic?.categoryConfidence ?? 0);
          if (category && Number.isFinite(categoryConfidence) && categoryConfidence >= 0.22) {
            return {
              semanticClusterId: `topic:${category.toLowerCase()}`,
              semanticClusterLabel: category,
              semanticClusterKind: 'topic' as const,
              semanticClusterAffinity: categoryConfidence,
            };
          }

          const strongestMode = [...(semantic?.modeAffinities ?? [])]
            .filter((entry) => Number.isFinite(entry.affinity) && entry.affinity > 0)
            .sort((left, right) => right.affinity - left.affinity || left.label.localeCompare(right.label))[0];
          if (strongestMode) {
            return {
              semanticClusterId: `mode:${strongestMode.modeId}`,
              semanticClusterLabel: strongestMode.label,
              semanticClusterKind: 'mode' as const,
              semanticClusterAffinity: strongestMode.affinity,
            };
          }
          return {
            semanticClusterId: null,
            semanticClusterLabel: null,
            semanticClusterKind: null,
            semanticClusterAffinity: null,
          };
        })(),
      };
    })
    .sort((left, right) => (
      left.kind.localeCompare(right.kind)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id)
    ));

  const edges = state.graph.edges
    .map((edge) => ({
      id: edge.id,
      relation: edge.relation,
      provenance: edge.provenance,
      confidence: edge.confidence,
      sourceNodeId: edge.sourceNodeId,
      sourceLabel: nodeById.get(edge.sourceNodeId)?.label ?? edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      targetLabel: nodeById.get(edge.targetNodeId)?.label ?? edge.targetNodeId,
      evidenceIds: [...edge.evidenceIds],
      evidence: edge.evidenceIds
        .map(toEvidence)
        .filter((record): record is GraphInspectorEvidence => Boolean(record))
        .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id)),
    }))
    .sort((left, right) => (
      left.relation.localeCompare(right.relation)
      || left.sourceLabel.localeCompare(right.sourceLabel)
      || left.targetLabel.localeCompare(right.targetLabel)
      || left.id.localeCompare(right.id)
    ));

  return {
    schemaVersion: state.schemaVersion,
    graphRevision: state.graph.currentRevision,
    evidenceCount: state.evidence.length,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodesByKind: countBy(nodes.map((node) => node.kind)),
    edgesByRelation: countBy(edges.map((edge) => edge.relation)),
    nodes,
    edges,
    revisions: [...state.graph.revisions]
      .sort((left, right) => right.revision - left.revision || right.createdAt.localeCompare(left.createdAt))
      .map((revision) => ({
        revision: revision.revision,
        reason: revision.reason,
        createdAt: revision.createdAt,
      })),
  };
}

export function parseGraphInspectorExport(json: string): GraphInspectorView {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The pasted graph export is not valid JSON.');
  }
  return buildGraphInspectorView(parsed);
}


export type GraphModeOverlay = {
  modeId: string;
  modeLabel: string;
  modeRevision: number | null;
  memberNodeIds: string[];
  connectedNodeIds: string[];
  connectedEdgeIds: string[];
};

export function buildGraphModeOverlay(
  view: GraphInspectorView,
  catalog: DurableSemanticModeCatalog | null | undefined,
  modeId: string,
): GraphModeOverlay {
  if (!modeId || modeId === 'all' || modeId === 'default') {
    return {
      modeId: 'all',
      modeLabel: 'All graph',
      modeRevision: null,
      memberNodeIds: [],
      connectedNodeIds: [],
      connectedEdgeIds: [],
    };
  }

  const mode = catalog?.modes.find((entry) => entry.id === modeId);
  if (!mode) {
    return {
      modeId,
      modeLabel: modeId,
      modeRevision: null,
      memberNodeIds: [],
      connectedNodeIds: [],
      connectedEdgeIds: [],
    };
  }

  const availableNodeIds = new Set(view.nodes.map((node) => node.id));
  const memberNodeIds = new Set<string>();
  for (const member of mode.members) {
    if (availableNodeIds.has(member.canonicalId)) memberNodeIds.add(member.canonicalId);
    for (const sourceNodeId of member.sourceNodeIds) {
      if (availableNodeIds.has(sourceNodeId)) memberNodeIds.add(sourceNodeId);
    }
  }

  const connectedNodeIds = new Set(memberNodeIds);
  const connectedEdgeIds = new Set<string>();
  for (const edge of view.edges) {
    if (!memberNodeIds.has(edge.sourceNodeId) && !memberNodeIds.has(edge.targetNodeId)) continue;
    connectedEdgeIds.add(edge.id);
    connectedNodeIds.add(edge.sourceNodeId);
    connectedNodeIds.add(edge.targetNodeId);
  }

  return {
    modeId: mode.id,
    modeLabel: mode.label,
    modeRevision: mode.revision,
    memberNodeIds: [...memberNodeIds].sort(),
    connectedNodeIds: [...connectedNodeIds].sort(),
    connectedEdgeIds: [...connectedEdgeIds].sort(),
  };
}


export type ContentExplanation = {
  external_id: string;
  title: string;
  channel_name: string | null;
  thumbnail_url: string | null;
  score: number;
  rawScore: number;
  traceId: string;
  visible: boolean;
  suppressed: boolean;
  policyOutcome: 'eligible' | 'ineligible' | 'excluded' | 'suppressed';
  semantic_category: SemanticCategoryId | null;
  explanation: {
    rawScore: number;
    displayScore: number;
    graphRevision: number;
    policyRevision: string;
    acquisitionMechanism: string | null;
    contributions: Array<{
      label: string;
      value: number;
      kind: string;
      sourceId?: string;
      sourceIds?: string[];
      evidenceIds: string[];
      modeId?: string;
      modeRevision?: number;
      canonicalId?: string;
    }>;
    matchedPaths: Array<{
      nodeIds: string[];
      nodeLabels: string[];
      edgeIds: string[];
      evidenceIds: string[];
    }>;
    modeGrounding: {
      modeId: string;
      modeRevision: number;
      total: number;
      members: Array<{
        canonicalId: string;
        label: string;
        value: number;
        sourceIds: string[];
        evidenceIds: string[];
      }>;
    } | null;
  } | null;
};

export function buildExplanationGraphView(
  view: GraphInspectorView,
  contentNodeId: string,
  explanation: ContentExplanation['explanation'],
): GraphInspectorView {
  const nodeIds = new Set<string>([contentNodeId]);
  const edgeIds = new Set<string>();
  for (const path of explanation?.matchedPaths ?? []) {
    for (const nodeId of path.nodeIds) nodeIds.add(nodeId);
    for (const edgeId of path.edgeIds) edgeIds.add(edgeId);
  }
  for (const contribution of explanation?.contributions ?? []) {
    if (contribution.sourceId) nodeIds.add(contribution.sourceId);
    for (const sourceId of contribution.sourceIds ?? []) nodeIds.add(sourceId);
  }
  for (const member of explanation?.modeGrounding?.members ?? []) {
    nodeIds.add(member.canonicalId);
    for (const sourceId of member.sourceIds) nodeIds.add(sourceId);
  }

  // Include real stored edges only. If a matched path omits an edge identifier,
  // keep direct edges among included nodes so the compact explanation remains
  // connected without inventing relationships.
  const edges = view.edges.filter((edge) => (
    edgeIds.has(edge.id)
    || (nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))
  ));
  for (const edge of edges) {
    nodeIds.add(edge.sourceNodeId);
    nodeIds.add(edge.targetNodeId);
  }

  const nodes = view.nodes.filter((node) => nodeIds.has(node.id));
  return {
    ...view,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodesByKind: countBy(nodes.map((node) => node.kind)),
    edgesByRelation: countBy(edges.map((edge) => edge.relation)),
    nodes,
    edges,
  };
}
