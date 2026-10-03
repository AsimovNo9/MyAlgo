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
  inferredLabel: string | null;
  revision: number | null;
  active: boolean;
  pinned: boolean;
};

export function buildDurableModeOptions(
  currentModeId: string,
  catalog: DurableSemanticModeCatalog | null | undefined,
  currentModeLabel = 'Default',
  limit = 32,
): DurableModeOption[] {
  const result: DurableModeOption[] = [{
    id: 'default',
    label: 'All',
    inferredLabel: null,
    revision: null,
    active: true,
    pinned: false,
  }];
  const seen = new Set(['default']);
  const modes = [...(catalog?.modes ?? [])]
    .sort((left, right) => (
      Number(right.pinned) - Number(left.pinned)
      || Number(right.active) - Number(left.active)
      || right.lastSupportedAt.localeCompare(left.lastSupportedAt)
      || left.id.localeCompare(right.id)
    ));

  for (const mode of modes) {
    if (result.length >= limit + 1) break;
    if (!mode.id.trim() || seen.has(mode.id)) continue;
    result.push({
      id: mode.id,
      label: mode.label,
      inferredLabel: mode.inferredLabel ?? mode.label,
      revision: mode.revision,
      active: mode.active,
      pinned: mode.pinned,
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
        inferredLabel: current.inferredLabel ?? current.label,
        revision: current.revision,
        active: current.active,
        pinned: current.pinned,
      });
    } else if (currentId !== 'default') {
      result.push({
        id: currentId,
        label: currentModeLabel.trim() || currentId,
        inferredLabel: null,
        revision: null,
        active: false,
        pinned: false,
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
  confidence: number;
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

export type GraphInspectorControl = {
  id: string;
  targetKind: 'node' | 'edge';
  targetId: string;
  targetLabel: string;
  action: 'reduce' | 'prefer' | 'mute';
  createdAt: string;
  updatedAt: string;
};

export type GraphInspectorView = {
  schemaVersion: number;
  graphRevision: number;
  evidenceCount: number;
  forgottenEvidenceCount: number;
  nodeCount: number;
  edgeCount: number;
  nodesByKind: Array<{ key: string; count: number }>;
  edgesByRelation: Array<{ key: string; count: number }>;
  nodes: GraphInspectorNode[];
  edges: GraphInspectorEdge[];
  controls: GraphInspectorControl[];
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
  return [2, 3].includes(Number(candidate.schemaVersion))
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
  durableModeCatalog: DurableSemanticModeCatalog | null | undefined = null,
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
  const durableGroupByContentNodeId = new Map<string, {
    modeId: string;
    label: string;
    affinity: number;
  }>();
  for (const mode of durableModeCatalog?.modes ?? []) {
    const supportWeightByContentId = new Map<string, number>();
    for (const member of mode.members) {
      for (const contentId of member.supportContentIds) {
        supportWeightByContentId.set(
          contentId,
          (supportWeightByContentId.get(contentId) ?? 0) + Math.max(0, Number(member.weight ?? 0)),
        );
      }
    }
    for (const [contentId, affinity] of supportWeightByContentId.entries()) {
      const previous = durableGroupByContentNodeId.get(contentId);
      if (
        !previous
        || affinity > previous.affinity
        || (affinity === previous.affinity && mode.label.localeCompare(previous.label) < 0)
      ) {
        durableGroupByContentNodeId.set(contentId, {
          modeId: mode.id,
          label: mode.label,
          affinity,
        });
      }
    }
  }
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
      confidence: record.confidence,
      contentLabel,
    };
  };

  const baseNodes = state.graph.nodes
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
          const durableGroup = durableGroupByContentNodeId.get(node.id);
          if (durableGroup) {
            return {
              semanticClusterId: `mode:${durableGroup.modeId}`,
              semanticClusterLabel: durableGroup.label,
              semanticClusterKind: 'mode' as const,
              semanticClusterAffinity: durableGroup.affinity,
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

  const baseNodeById = new Map(baseNodes.map((node) => [node.id, node]));
  const creatorClusterStats = new Map<string, Map<string, {
    id: string;
    label: string;
    kind: 'mode' | 'topic';
    score: number;
    contentCount: number;
  }>>();
  for (const edge of state.graph.edges) {
    if (edge.relation !== 'created_by') continue;
    const content = baseNodeById.get(edge.sourceNodeId);
    const creator = baseNodeById.get(edge.targetNodeId);
    if (
      content?.kind !== 'content'
      || creator?.kind !== 'creator'
      || !content.semanticClusterId
      || !content.semanticClusterLabel
      || !content.semanticClusterKind
    ) continue;
    const byCluster = creatorClusterStats.get(creator.id) ?? new Map();
    const current = byCluster.get(content.semanticClusterId);
    const contribution = Math.max(0.1, Number(content.semanticClusterAffinity ?? 1));
    byCluster.set(content.semanticClusterId, {
      id: content.semanticClusterId,
      label: content.semanticClusterLabel,
      kind: content.semanticClusterKind,
      score: (current?.score ?? 0) + contribution,
      contentCount: (current?.contentCount ?? 0) + 1,
    });
    creatorClusterStats.set(creator.id, byCluster);
  }

  const nodes = baseNodes
    .map((node) => {
      if (node.kind !== 'creator') return node;
      const candidates = [...(creatorClusterStats.get(node.id)?.values() ?? [])];
      if (candidates.length === 0) return node;
      const totalScore = candidates.reduce((sum, entry) => sum + entry.score, 0);
      const strongest = candidates.sort((left, right) => (
        right.score - left.score
        || right.contentCount - left.contentCount
        || Number(right.kind === 'mode') - Number(left.kind === 'mode')
        || left.label.localeCompare(right.label)
        || left.id.localeCompare(right.id)
      ))[0]!;
      return {
        ...node,
        semanticClusterId: strongest.id,
        semanticClusterLabel: strongest.label,
        semanticClusterKind: strongest.kind,
        semanticClusterAffinity: totalScore > 0 ? strongest.score / totalScore : 0,
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
    forgottenEvidenceCount: Array.isArray(state.forgottenEvidence) ? state.forgottenEvidence.length : 0,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodesByKind: countBy(nodes.map((node) => node.kind)),
    edgesByRelation: countBy(edges.map((edge) => edge.relation)),
    nodes,
    edges,
    controls: [...(state.graph.controls ?? [])]
      .map((control) => {
        const node = control.targetKind === 'node'
          ? nodeById.get(control.targetId)
          : null;
        const edge = control.targetKind === 'edge'
          ? edges.find((entry) => entry.id === control.targetId)
          : null;
        return {
          id: control.id,
          targetKind: control.targetKind,
          targetId: control.targetId,
          targetLabel: node?.label
            ?? (edge ? `${edge.sourceLabel} → ${edge.targetLabel} · ${edge.relation}` : control.targetId),
          action: control.action,
          createdAt: control.createdAt,
          updatedAt: control.updatedAt,
        };
      })
      .sort((left, right) => (
        left.action.localeCompare(right.action)
        || left.targetLabel.localeCompare(right.targetLabel)
        || left.id.localeCompare(right.id)
      )),
    revisions: [...state.graph.revisions]
      .sort((left, right) => right.revision - left.revision || right.createdAt.localeCompare(left.createdAt))
      .map((revision) => ({
        revision: revision.revision,
        reason: revision.reason,
        createdAt: revision.createdAt,
      })),
  };
}

export type GraphGroupCoverage = {
  contentCount: number;
  durableGroupedContentCount: number;
  topicClusteredContentCount: number;
  ungroupedContentCount: number;
  structuralNodeCount: number;
  associatedCreatorCount: number;
  unassociatedStructuralNodeCount: number;
  durableGroupCount: number;
  topicClusterCount: number;
  groups: Array<{
    id: string;
    label: string;
    kind: 'mode' | 'topic';
    count: number;
  }>;
};

export function summarizeGraphGroupCoverage(view: GraphInspectorView): GraphGroupCoverage {
  const contentNodes = view.nodes.filter((node) => node.kind === 'content');
  const structuralNodes = view.nodes.filter((node) => node.kind !== 'content');
  const structuralNodeCount = structuralNodes.length;
  const associatedCreatorCount = structuralNodes.filter((node) => (
    node.kind === 'creator' && Boolean(node.semanticClusterId)
  )).length;
  const unassociatedStructuralNodeCount = structuralNodeCount - associatedCreatorCount;
  const groups = new Map<string, {
    id: string;
    label: string;
    kind: 'mode' | 'topic';
    count: number;
  }>();

  let durableGroupedContentCount = 0;
  let topicClusteredContentCount = 0;
  let ungroupedContentCount = 0;

  for (const node of contentNodes) {
    if (!node.semanticClusterId || !node.semanticClusterLabel || !node.semanticClusterKind) {
      ungroupedContentCount += 1;
      continue;
    }
    if (node.semanticClusterKind === 'mode') durableGroupedContentCount += 1;
    else topicClusteredContentCount += 1;

    const current = groups.get(node.semanticClusterId);
    if (current) {
      current.count += 1;
    } else {
      groups.set(node.semanticClusterId, {
        id: node.semanticClusterId,
        label: node.semanticClusterLabel,
        kind: node.semanticClusterKind,
        count: 1,
      });
    }
  }

  const orderedGroups = [...groups.values()].sort((left, right) => (
    Number(right.kind === 'mode') - Number(left.kind === 'mode')
    || right.count - left.count
    || left.label.localeCompare(right.label)
    || left.id.localeCompare(right.id)
  ));

  return {
    contentCount: contentNodes.length,
    durableGroupedContentCount,
    topicClusteredContentCount,
    ungroupedContentCount,
    structuralNodeCount,
    associatedCreatorCount,
    unassociatedStructuralNodeCount,
    durableGroupCount: orderedGroups.filter((group) => group.kind === 'mode').length,
    topicClusterCount: orderedGroups.filter((group) => group.kind === 'topic').length,
    groups: orderedGroups,
  };
}

export function applyDurableModeLabelsToGraphInspector(
  view: GraphInspectorView,
  catalog: DurableSemanticModeCatalog | null | undefined,
): GraphInspectorView {
  if (!catalog || catalog.modes.length === 0) return view;
  const labelByModeId = new Map(catalog.modes.map((mode) => [mode.id, mode.label]));
  let changed = false;
  const nodes = view.nodes.map((node) => {
    if (node.semanticClusterKind !== 'mode' || !node.semanticClusterId) return node;
    const modeId = node.semanticClusterId.startsWith('mode:')
      ? node.semanticClusterId.slice('mode:'.length)
      : node.semanticClusterId;
    const label = labelByModeId.get(modeId);
    if (!label || label === node.semanticClusterLabel) return node;
    changed = true;
    return {
      ...node,
      semanticClusterLabel: label,
    };
  });
  return changed ? { ...view, nodes } : view;
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
    semanticInputSources: Array<'metadata' | 'transcript'>;
    transcriptSource: 'youtube_caption_track' | null;
    transcriptLanguage: string | null;
    transcriptAutoGenerated: boolean | null;
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
    historySupport: {
      scoreSharePercent: number;
      matchedVideoCount: number;
      matches: Array<{
        evidenceId: string;
        externalId: string;
        title: string;
        observedAt: string;
        interaction: string;
        matchedBy: string[];
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
