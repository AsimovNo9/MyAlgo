import type { GraphNode, PersonalAlgorithmState } from '@repo/shared-types';

import { cosineSimilarity } from './semantic-primitives.ts';

export const CANONICAL_SEMANTIC_PIPELINE_ID = 'canonical-semantic-neighbourhood-v1';

export type CanonicalSemanticKind = 'objective' | 'topic' | 'concept';

export type CanonicalSemanticConcept = {
  id: string;
  label: string;
  normalizedLabel: string;
  representativeNodeId: string;
  sourceNodeIds: string[];
  aliases: string[];
  kinds: CanonicalSemanticKind[];
  provenance: 'explicit' | 'inferred' | 'mixed';
  sourceKinds: string[];
  taxonomyOnly: boolean;
  evidenceIds: string[];
  pipelineId: typeof CANONICAL_SEMANTIC_PIPELINE_ID;
  embeddingModelVersion: string | null;
};

export type CanonicalSemanticBuildOptions = {
  embeddingsByNodeId?: ReadonlyMap<string, readonly number[]>;
  embeddingModelVersion?: string | null;
  embeddingSimilarityThreshold?: number;
};

export type CanonicalSemanticBuildResult = {
  marker: typeof CANONICAL_SEMANTIC_PIPELINE_ID;
  concepts: CanonicalSemanticConcept[];
  assignmentByNodeId: Record<string, string>;
  diagnostics: {
    sourceNodeCount: number;
    canonicalConceptCount: number;
    mergedNodeCount: number;
    taxonomyConceptCount: number;
    embeddingComparisonCount: number;
    embeddingMergeCount: number;
    explicitSimilarityMergeBlockedCount: number;
  };
};

const GENERIC_ALIAS_TOKENS = new Set([
  'beginner',
  'beginners',
  'case',
  'cases',
  'explained',
  'full',
  'game',
  'gameplay',
  'guide',
  'guides',
  'how',
  'reaction',
  'reactions',
  'review',
  'reviews',
  'tips',
  'to',
  'tutorial',
  'tutorials',
  'use',
  'uses',
  'using',
  'walkthrough',
  'walkthroughs',
]);

const normalizeSemanticLabel = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}+#.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const aliasNormalizationKey = (value: string): string => {
  const normalized = normalizeSemanticLabel(value);
  const tokens = normalized.split(' ').filter(Boolean);
  const substantive = tokens.filter((token) => !GENERIC_ALIAS_TOKENS.has(token));
  return substantive.length >= 2 ? substantive.join(' ') : normalized;
};

const nodeSourceKinds = (node: GraphNode): string[] => (
  Array.isArray(node.attributes?.sourceKinds)
    ? [...new Set(node.attributes.sourceKinds.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    ))].sort()
    : []
);

const isTaxonomyOnlyNode = (node: GraphNode): boolean => {
  const sourceKinds = nodeSourceKinds(node);
  return node.kind === 'concept'
    && sourceKinds.length > 0
    && sourceKinds.every((kind) => kind === 'content_type');
};

const semanticNodes = (state: PersonalAlgorithmState): GraphNode[] =>
  state.graph.nodes
    .filter((node): node is GraphNode => (
      ['objective', 'topic', 'concept'].includes(node.kind)
      && node.label.trim().length > 0
    ))
    .sort((left, right) => left.id.localeCompare(right.id));

class UnionFind {
  private readonly parent = new Map<string, string>();

  constructor(ids: readonly string[]) {
    ids.forEach((id) => this.parent.set(id, id));
  }

  find(id: string): string {
    const current = this.parent.get(id) ?? id;
    if (current === id) return current;
    const root = this.find(current);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string): boolean {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return false;
    const [first, second] = [leftRoot, rightRoot].sort();
    this.parent.set(second, first);
    return true;
  }
}

const lexicalCompatibility = (left: string, right: string): boolean => {
  const leftTokens = new Set(aliasNormalizationKey(left).split(' ').filter(Boolean));
  const rightTokens = new Set(aliasNormalizationKey(right).split(' ').filter(Boolean));
  if (leftTokens.size < 2 || rightTokens.size < 2) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (shared < 2) return false;
  return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.5;
};

const canonicalGroupKey = (nodes: readonly GraphNode[]): string => {
  const representative = [...nodes].sort((left, right) => (
    Number(right.provenance === 'explicit') - Number(left.provenance === 'explicit')
    || Number(isTaxonomyOnlyNode(left)) - Number(isTaxonomyOnlyNode(right))
    || (right.confidence ?? 0) - (left.confidence ?? 0)
    || normalizeSemanticLabel(left.label).length - normalizeSemanticLabel(right.label).length
    || left.id.localeCompare(right.id)
  ))[0];

  if (!representative) return 'empty';
  if (representative.kind === 'objective') return `objective:${representative.id}`;
  if (nodes.some((node) => node.provenance === 'explicit')) {
    const explicit = nodes
      .filter((node) => node.provenance === 'explicit')
      .sort((left, right) => left.id.localeCompare(right.id))[0];
    return `explicit:${explicit?.id ?? representative.id}`;
  }
  const prefix = nodes.every(isTaxonomyOnlyNode) ? 'taxonomy' : 'specific';
  const key = [...new Set(nodes.map((node) => aliasNormalizationKey(node.label)))].sort()[0]
    ?? normalizeSemanticLabel(representative.label);
  return `${prefix}:${key}`;
};

const chooseRepresentative = (nodes: readonly GraphNode[]): GraphNode =>
  [...nodes].sort((left, right) => (
    Number(right.provenance === 'explicit') - Number(left.provenance === 'explicit')
    || Number(isTaxonomyOnlyNode(left)) - Number(isTaxonomyOnlyNode(right))
    || (right.confidence ?? 0) - (left.confidence ?? 0)
    || normalizeSemanticLabel(left.label).length - normalizeSemanticLabel(right.label).length
    || left.id.localeCompare(right.id)
  ))[0]!;

export function buildCanonicalSemanticConcepts(
  state: PersonalAlgorithmState,
  options: CanonicalSemanticBuildOptions = {},
): CanonicalSemanticBuildResult {
  const nodes = semanticNodes(state);
  const semanticById = new Map(nodes.map((node) => [node.id, node]));
  const unionFind = new UnionFind(nodes.map((node) => node.id));

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex]!;
    if (left.kind === 'objective') continue;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex]!;
      if (right.kind === 'objective') continue;
      if (isTaxonomyOnlyNode(left) !== isTaxonomyOnlyNode(right)) continue;

      const leftNormalized = normalizeSemanticLabel(left.label);
      const rightNormalized = normalizeSemanticLabel(right.label);
      if (leftNormalized === rightNormalized) {
        unionFind.union(left.id, right.id);
        continue;
      }

      if (
        left.provenance !== 'explicit'
        && right.provenance !== 'explicit'
        && aliasNormalizationKey(left.label) === aliasNormalizationKey(right.label)
      ) {
        unionFind.union(left.id, right.id);
      }
    }
  }

  const threshold = Math.max(0, Math.min(1, options.embeddingSimilarityThreshold ?? 0.92));
  let embeddingComparisonCount = 0;
  let embeddingMergeCount = 0;
  let explicitSimilarityMergeBlockedCount = 0;
  const embeddings = options.embeddingsByNodeId;

  if (embeddings) {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex]!;
      if (left.kind === 'objective' || isTaxonomyOnlyNode(left)) continue;
      const leftEmbedding = embeddings.get(left.id);
      if (!leftEmbedding?.length) continue;

      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex]!;
        if (right.kind === 'objective' || isTaxonomyOnlyNode(right)) continue;
        if (unionFind.find(left.id) === unionFind.find(right.id)) continue;

        const rightEmbedding = embeddings.get(right.id);
        if (!rightEmbedding?.length || rightEmbedding.length !== leftEmbedding.length) continue;
        if (!lexicalCompatibility(left.label, right.label)) continue;

        embeddingComparisonCount += 1;
        const similarity = Math.max(0, cosineSimilarity(leftEmbedding, rightEmbedding));
        if (similarity < threshold) continue;
        if (left.provenance === 'explicit' || right.provenance === 'explicit') {
          explicitSimilarityMergeBlockedCount += 1;
          continue;
        }
        if (unionFind.union(left.id, right.id)) embeddingMergeCount += 1;
      }
    }
  }

  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const root = unionFind.find(node.id);
    const group = groups.get(root) ?? [];
    group.push(node);
    groups.set(root, group);
  }

  const concepts: CanonicalSemanticConcept[] = [];
  const assignmentByNodeId: Record<string, string> = {};

  for (const group of groups.values()) {
    group.sort((left, right) => left.id.localeCompare(right.id));
    const representative = chooseRepresentative(group);
    const groupKey = canonicalGroupKey(group);
    const id = `canonical:semantic:v1:${encodeURIComponent(groupKey)}`;
    const sourceNodeIds = group.map((node) => node.id).sort();
    const sourceNodeSet = new Set(sourceNodeIds);
    const evidenceIds = [...new Set(state.graph.edges
      .filter((edge) => sourceNodeSet.has(edge.sourceNodeId) || sourceNodeSet.has(edge.targetNodeId))
      .flatMap((edge) => edge.evidenceIds ?? []))]
      .filter(Boolean)
      .sort();
    const aliases = [...new Set(group.map((node) => node.label.trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    const kinds = [...new Set(group.map((node) => node.kind as CanonicalSemanticKind))]
      .sort((left, right) => left.localeCompare(right));
    const provenances = new Set(group.map((node) => node.provenance));
    const sourceKinds = [...new Set(group.flatMap(nodeSourceKinds))].sort();
    const concept: CanonicalSemanticConcept = {
      id,
      label: representative.label.trim(),
      normalizedLabel: aliasNormalizationKey(representative.label),
      representativeNodeId: representative.id,
      sourceNodeIds,
      aliases,
      kinds,
      provenance: provenances.size > 1
        ? 'mixed'
        : representative.provenance,
      sourceKinds,
      taxonomyOnly: group.every(isTaxonomyOnlyNode),
      evidenceIds,
      pipelineId: CANONICAL_SEMANTIC_PIPELINE_ID,
      embeddingModelVersion: options.embeddingModelVersion?.trim() || null,
    };
    concepts.push(concept);
    for (const nodeId of sourceNodeIds) assignmentByNodeId[nodeId] = concept.id;
  }

  concepts.sort((left, right) => left.id.localeCompare(right.id));

  return {
    marker: CANONICAL_SEMANTIC_PIPELINE_ID,
    concepts,
    assignmentByNodeId,
    diagnostics: {
      sourceNodeCount: nodes.length,
      canonicalConceptCount: concepts.length,
      mergedNodeCount: Math.max(0, nodes.length - concepts.length),
      taxonomyConceptCount: concepts.filter((concept) => concept.taxonomyOnly).length,
      embeddingComparisonCount,
      embeddingMergeCount,
      explicitSimilarityMergeBlockedCount,
    },
  };
}

export function canonicalConceptByNodeId(
  result: Pick<CanonicalSemanticBuildResult, 'concepts' | 'assignmentByNodeId'>,
): Map<string, CanonicalSemanticConcept> {
  const byId = new Map(result.concepts.map((concept) => [concept.id, concept]));
  return new Map(
    Object.entries(result.assignmentByNodeId)
      .map(([nodeId, canonicalId]) => [nodeId, byId.get(canonicalId)] as const)
      .filter((entry): entry is readonly [string, CanonicalSemanticConcept] => Boolean(entry[1])),
  );
}

export function canonicalSemanticNode(
  state: PersonalAlgorithmState,
  nodeId: string,
): GraphNode | null {
  return semanticByIdForState(state).get(nodeId) ?? null;
}

const semanticByIdForState = (state: PersonalAlgorithmState): Map<string, GraphNode> =>
  new Map(semanticNodes(state).map((node) => [node.id, node]));
