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

const supportKeysByNodeId = (
  state: PersonalAlgorithmState,
  nodeIds: ReadonlySet<string>,
): Map<string, Set<string>> => {
  const support = new Map<string, Set<string>>();
  for (const nodeId of nodeIds) support.set(nodeId, new Set());
  for (const edge of state.graph.edges) {
    const source = support.get(edge.sourceNodeId);
    if (source) {
      source.add(`node:${edge.targetNodeId}`);
      for (const evidenceId of edge.evidenceIds ?? []) source.add(`evidence:${evidenceId}`);
    }
    const target = support.get(edge.targetNodeId);
    if (target) {
      target.add(`node:${edge.sourceNodeId}`);
      for (const evidenceId of edge.evidenceIds ?? []) target.add(`evidence:${evidenceId}`);
    }
  }
  return support;
};

const sharesSupport = (
  left: ReadonlySet<string> | undefined,
  right: ReadonlySet<string> | undefined,
): boolean => {
  if (!left?.size || !right?.size) return false;
  for (const key of left) if (right.has(key)) return true;
  return false;
};

const canonicalGroupKey = (nodes: readonly GraphNode[]): string => {
  const representative = chooseRepresentative(nodes);
  if (!representative) return 'empty';
  if (representative.kind === 'objective') return `objective:${representative.id}`;
  if (nodes.some((node) => node.provenance === 'explicit')) {
    const explicit = nodes
      .filter((node) => node.provenance === 'explicit')
      .sort((left, right) => (
        left.createdAt.localeCompare(right.createdAt)
        || left.id.localeCompare(right.id)
      ))[0];
    return `explicit:${explicit?.id ?? representative.id}`;
  }
  const prefix = nodes.every(isTaxonomyOnlyNode) ? 'taxonomy' : 'specific';
  const anchor = [...nodes].sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id)
  ))[0] ?? representative;
  return `${prefix}:${aliasNormalizationKey(anchor.label)}`;
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
  const unionFind = new UnionFind(nodes.map((node) => node.id));

  const unionBucket = (bucket: readonly GraphNode[]) => {
    const first = bucket[0];
    if (!first) return;
    for (let index = 1; index < bucket.length; index += 1) {
      unionFind.union(first.id, bucket[index]!.id);
    }
  };
  const exactBuckets = new Map<string, GraphNode[]>();
  const inferredAliasBuckets = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (node.kind === 'objective') continue;
    const taxonomy = isTaxonomyOnlyNode(node) ? 'taxonomy' : 'specific';
    const exactKey = `${taxonomy}:${normalizeSemanticLabel(node.label)}`;
    const exact = exactBuckets.get(exactKey) ?? [];
    exact.push(node);
    exactBuckets.set(exactKey, exact);
    if (node.provenance !== 'explicit') {
      const aliasKey = `${taxonomy}:${aliasNormalizationKey(node.label)}`;
      const aliases = inferredAliasBuckets.get(aliasKey) ?? [];
      aliases.push(node);
      inferredAliasBuckets.set(aliasKey, aliases);
    }
  }
  for (const bucket of exactBuckets.values()) unionBucket(bucket);
  for (const bucket of inferredAliasBuckets.values()) unionBucket(bucket);

  const threshold = Math.max(0, Math.min(1, options.embeddingSimilarityThreshold ?? 0.94));
  let embeddingComparisonCount = 0;
  let embeddingMergeCount = 0;
  let explicitSimilarityMergeBlockedCount = 0;
  const embeddings = options.embeddingsByNodeId;
  const supportByNodeId = supportKeysByNodeId(state, new Set(nodes.map((node) => node.id)));

  if (embeddings) {
    const embeddedNodes = nodes.filter((node) => (
      node.kind !== 'objective'
      && !isTaxonomyOnlyNode(node)
      && Boolean(embeddings.get(node.id)?.length)
    ));
    for (let leftIndex = 0; leftIndex < embeddedNodes.length; leftIndex += 1) {
      const left = embeddedNodes[leftIndex]!;
      const leftEmbedding = embeddings.get(left.id)!;

      for (let rightIndex = leftIndex + 1; rightIndex < embeddedNodes.length; rightIndex += 1) {
        const right = embeddedNodes[rightIndex]!;
        if (unionFind.find(left.id) === unionFind.find(right.id)) continue;

        const rightEmbedding = embeddings.get(right.id);
        if (!rightEmbedding?.length || rightEmbedding.length !== leftEmbedding.length) continue;
        const assignmentSignal = lexicalCompatibility(left.label, right.label)
          || sharesSupport(supportByNodeId.get(left.id), supportByNodeId.get(right.id));
        if (!assignmentSignal) continue;

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
