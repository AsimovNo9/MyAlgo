import type { PersonalAlgorithmState, SemanticModeProfile } from '@repo/shared-types';

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index] ?? 0);
    const rightValue = Number(right[index] ?? 0);
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude <= 0 || rightMagnitude <= 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftMagnitude * rightMagnitude)));
}

export function weightedEmbeddingCentroid(
  vectors: Array<{ embedding: readonly number[]; weight: number }>,
): number[] {
  const eligible = vectors.filter((item) => (
    item.embedding.length > 0
    && Number.isFinite(item.weight)
    && item.weight > 0
  ));
  if (eligible.length === 0) return [];
  const dimensions = eligible[0]?.embedding.length ?? 0;
  if (dimensions === 0 || eligible.some((item) => item.embedding.length !== dimensions)) return [];

  const centroid = new Array<number>(dimensions).fill(0);
  let totalWeight = 0;
  for (const item of eligible) {
    totalWeight += item.weight;
    for (let index = 0; index < dimensions; index += 1) {
      centroid[index] += Number(item.embedding[index] ?? 0) * item.weight;
    }
  }
  if (totalWeight <= 0) return [];
  for (let index = 0; index < dimensions; index += 1) centroid[index] /= totalWeight;

  const magnitude = Math.sqrt(centroid.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? centroid.map((value) => value / magnitude) : centroid;
}

export function semanticModeSeed(mode: string): string {
  const value = mode.trim();
  return value && value.toLowerCase() !== 'default' ? value : 'personal interests';
}

export function buildSemanticModeProfile(
  state: PersonalAlgorithmState,
  mode: string,
  nodeSimilarities: Record<string, number>,
  options: { maxNodes?: number; minimumSimilarity?: number } = {},
): SemanticModeProfile {
  const maxNodes = Math.max(1, Math.floor(options.maxNodes ?? 12));
  const minimumSimilarity = Math.max(-1, Math.min(1, options.minimumSimilarity ?? 0.2));
  const eligibleKinds = new Set(['objective', 'topic', 'concept']);

  const ranked = state.graph.nodes
    .filter((node) => eligibleKinds.has(node.kind) && node.label.trim())
    .map((node) => {
      const similarity = Math.max(-1, Math.min(1, Number(nodeSimilarities[node.id] ?? 0)));
      const confidence = Math.max(0, Math.min(1, node.confidence ?? 1));
      const provenanceWeight = node.provenance === 'explicit' ? 1.15 : 1;
      const kindWeight = node.kind === 'objective' ? 1.2 : node.kind === 'topic' ? 1.1 : 1;
      return {
        node,
        similarity,
        weight: Math.max(0, similarity) * confidence * provenanceWeight * kindWeight,
      };
    })
    .filter((entry) => entry.similarity >= minimumSimilarity && entry.weight > 0)
    .sort((left, right) => right.weight - left.weight || left.node.id.localeCompare(right.node.id))
    .slice(0, maxNodes);

  const maxWeight = ranked[0]?.weight ?? 1;
  const nodeWeights = Object.fromEntries(ranked.map((entry) => [
    entry.node.id,
    Number((entry.weight / maxWeight).toFixed(4)),
  ]));
  const semanticTerms = ranked.map((entry) => entry.node.label.trim());

  return {
    id: `mode:${mode.trim().toLowerCase() || 'default'}`,
    label: mode.trim() || 'Default',
    seed_text: semanticModeSeed(mode),
    graph_revision: state.graph.currentRevision,
    node_weights: nodeWeights,
    semantic_terms: semanticTerms,
    model_version: null,
    embedding: null,
  };
}
