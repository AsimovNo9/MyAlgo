import type {
  EmbeddingRecord,
  PersonalAlgorithmState,
  RecommendationCandidate,
  SemanticModeProfile,
} from '@repo/shared-types';

import {
  buildSemanticModeProfile,
  cosineSimilarity,
  semanticModeSeed,
  weightedEmbeddingCentroid,
} from './semantic-primitives.ts';

export interface LocalEmbeddingProvider {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface EmbeddingCache {
  get(key: string): Promise<EmbeddingRecord | null>;
  set(key: string, record: EmbeddingRecord): Promise<void>;
  flush?(): Promise<void>;
}

export type SemanticRerankingDiagnostics = {
  modelId: string;
  modelVersion: string;
  graphNodesConsidered: number;
  graphEmbeddingsComputed: number;
  graphEmbeddingsFromCache: number;
  candidateEmbeddingsComputed: number;
  candidateEmbeddingsFromCache: number;
  candidateCount: number;
  modeNodeCount: number;
};

export type SemanticRerankingResult<T extends RecommendationCandidate> = {
  candidates: Array<T & {
    semantic_similarity?: number | null;
    semantic_graph_similarity?: number | null;
    semantic_mode_similarity?: number | null;
    semantic_model_version?: string | null;
    semantic_graph_matches?: Array<{
      node_id: string;
      node_label: string;
      similarity: number;
      weight: number;
    }>;
  }>;
  modeProfile: SemanticModeProfile;
  diagnostics: SemanticRerankingDiagnostics;
};

const hashToken = (value: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const embeddingTerms = (text: string): string[] => {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];

  const words = normalized.split(' ').filter((token) => token.length >= 2);
  const bigrams = words
    .slice(0, -1)
    .map((token, index) => `${token}_${words[index + 1]}`);
  const characterNgrams = words.flatMap((word) => {
    if (word.length < 4) return [];
    const padded = `^${word}$`;
    const grams: string[] = [];
    for (let index = 0; index <= padded.length - 3; index += 1) {
      grams.push(padded.slice(index, index + 3));
    }
    return grams;
  });

  return [...words, ...bigrams, ...characterNgrams];
};

/**
 * Small dependency-free local embedding baseline.
 *
 * This is deliberately not presented as a neural semantic model. It provides a
 * deterministic hashed word/phrase/subword vector so the full semantic
 * reranking/caching/mode pipeline can run locally now. The provider contract is
 * intentionally identical to the future compact transformer encoder.
 */
export function createLocalHashEmbeddingProvider(
  dimensions = 192,
): LocalEmbeddingProvider {
  const safeDimensions = Math.max(32, Math.min(1024, Math.floor(dimensions)));
  return {
    modelId: 'myalgo-local-hash-embedding',
    modelVersion: `hash-v1-d${safeDimensions}`,
    dimensions: safeDimensions,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Array<number>(safeDimensions).fill(0);
        const terms = embeddingTerms(text);
        for (const term of terms) {
          const primary = hashToken(term, 0x811c9dc5);
          const secondary = hashToken(term, 0x9e3779b9);
          const index = primary % safeDimensions;
          const secondaryIndex = secondary % safeDimensions;
          const weight = term.includes('_') ? 1.25 : term.length === 3 ? 0.05 : 1;
          // Keep the lexical baseline non-negative so exact/shared terms and
          // subwords increase similarity predictably. A second low-weight bin
          // reduces single-hash collision sensitivity without pretending this
          // baseline has learned neural semantics.
          vector[index] += weight;
          if (secondaryIndex !== index) vector[secondaryIndex] += weight * 0.2;
        }
        return vector;
      });
    },
  };
}

const normalizeText = (value: string | null | undefined): string =>
  (value ?? '').replace(/\s+/g, ' ').trim();

export function buildCandidateEmbeddingText(candidate: RecommendationCandidate): string {
  const parts = [
    candidate.title,
    candidate.description ?? '',
    ...(candidate.topics ?? []),
    candidate.content_type ?? '',
    candidate.format ?? '',
    candidate.channel_name ?? '',
  ].map(normalizeText).filter(Boolean);
  return [...new Set(parts)].join(' | ').slice(0, 6000);
}

export function buildGraphNodeEmbeddingText(
  node: PersonalAlgorithmState['graph']['nodes'][number],
): string {
  const aliases = Array.isArray(node.attributes?.aliases)
    ? node.attributes.aliases.filter((value): value is string => typeof value === 'string')
    : [];
  const description = typeof node.attributes?.description === 'string'
    ? node.attributes.description
    : '';
  return [
    node.kind,
    node.label,
    description,
    ...aliases,
  ].map(normalizeText).filter(Boolean).join(' | ').slice(0, 3000);
}

// Stable non-cryptographic hash used only as an embedding-cache identity.
export function semanticInputHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function embeddingCacheKey(
  provider: Pick<LocalEmbeddingProvider, 'modelId' | 'modelVersion'>,
  ownerType: EmbeddingRecord['owner_type'],
  ownerId: string,
  inputHash: string,
): string {
  return [
    provider.modelId,
    provider.modelVersion,
    ownerType,
    ownerId,
    inputHash,
  ].map(encodeURIComponent).join(':');
}

const l2Normalize = (vector: readonly number[]): number[] => {
  const finite = vector.map((value) => Number.isFinite(value) ? Number(value) : 0);
  const magnitude = Math.sqrt(finite.reduce((sum, value) => sum + value * value, 0));
  return magnitude > 0 ? finite.map((value) => value / magnitude) : finite;
};

async function embedWithCache(
  provider: LocalEmbeddingProvider,
  cache: EmbeddingCache,
  inputs: Array<{
    ownerType: EmbeddingRecord['owner_type'];
    ownerId: string;
    text: string;
  }>,
): Promise<{
  records: EmbeddingRecord[];
  computed: number;
  fromCache: number;
}> {
  const records = new Array<EmbeddingRecord>(inputs.length);
  const misses: Array<{ index: number; inputHash: string; text: string; key: string }> = [];
  let fromCache = 0;

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const inputHash = semanticInputHash(input.text);
    const key = embeddingCacheKey(provider, input.ownerType, input.ownerId, inputHash);
    const cached = await cache.get(key);
    if (
      cached
      && cached.model_id === provider.modelId
      && cached.model_version === provider.modelVersion
      && cached.dimensions === provider.dimensions
      && cached.input_hash === inputHash
      && cached.embedding.length === provider.dimensions
    ) {
      records[index] = cached;
      fromCache += 1;
    } else {
      misses.push({ index, inputHash, text: input.text, key });
    }
  }

  if (misses.length > 0) {
    const vectors = await provider.embed(misses.map((miss) => miss.text));
    if (vectors.length !== misses.length) {
      throw new Error(`Embedding provider returned ${vectors.length} vectors for ${misses.length} inputs.`);
    }

    const generatedAt = new Date().toISOString();
    for (let missIndex = 0; missIndex < misses.length; missIndex += 1) {
      const miss = misses[missIndex];
      const vector = l2Normalize(vectors[missIndex] ?? []);
      if (vector.length !== provider.dimensions) {
        throw new Error(`Embedding provider returned ${vector.length} dimensions; expected ${provider.dimensions}.`);
      }
      const input = inputs[miss.index];
      const record: EmbeddingRecord = {
        owner_type: input.ownerType,
        owner_id: input.ownerId,
        model_id: provider.modelId,
        model_version: provider.modelVersion,
        input_hash: miss.inputHash,
        dimensions: provider.dimensions,
        embedding: vector,
        generated_at: generatedAt,
      };
      records[miss.index] = record;
      await cache.set(miss.key, record);
    }
  }

  await cache.flush?.();
  return { records, computed: misses.length, fromCache };
}

const graphNodeWeight = (
  node: PersonalAlgorithmState['graph']['nodes'][number],
): number => {
  const confidence = Math.max(0, Math.min(1, node.confidence ?? 1));
  const provenance = node.provenance === 'explicit' ? 1.2 : 1;
  const kind = node.kind === 'objective' ? 1.3 : node.kind === 'topic' ? 1.15 : 1;
  return confidence * provenance * kind;
};

const positiveSimilarity = (left: readonly number[], right: readonly number[]): number =>
  Math.max(0, cosineSimilarity(left, right));

export async function enrichCandidatesWithSemanticReranking<T extends RecommendationCandidate>(
  state: PersonalAlgorithmState,
  candidates: readonly T[],
  mode: string,
  provider: LocalEmbeddingProvider,
  cache: EmbeddingCache,
  options: {
    maxGraphNodes?: number;
    minimumModeNodeSimilarity?: number;
    onEmbeddingPhase?: (phase: 'graph_embeddings' | 'mode_seed' | 'candidate_embeddings', inputCount: number) => void | Promise<void>;
  } = {},
): Promise<SemanticRerankingResult<T>> {
  const maxGraphNodes = Math.max(1, Math.floor(options.maxGraphNodes ?? 64));
  const eligibleGraphNodes = state.graph.nodes
    .filter((node) => ['objective', 'topic', 'concept'].includes(node.kind) && node.label.trim())
    .sort((left, right) => {
      const explicitDelta = Number(right.provenance === 'explicit') - Number(left.provenance === 'explicit');
      if (explicitDelta !== 0) return explicitDelta;
      const confidenceDelta = (right.confidence ?? 0) - (left.confidence ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      const kindOrder = { objective: 0, topic: 1, concept: 2 } as Record<string, number>;
      return (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9)
        || left.id.localeCompare(right.id);
    })
    .slice(0, maxGraphNodes);

  const graphInputs = eligibleGraphNodes.map((node) => ({
    ownerType: 'graph_node' as const,
    ownerId: node.id,
    text: buildGraphNodeEmbeddingText(node),
  }));
  await options.onEmbeddingPhase?.('graph_embeddings', graphInputs.length);
  const graphEmbeddings = await embedWithCache(provider, cache, graphInputs);
  const nodeEmbeddingById = new Map(
    eligibleGraphNodes.map((node, index) => [node.id, graphEmbeddings.records[index]?.embedding ?? []]),
  );

  const seedText = semanticModeSeed(mode);
  await options.onEmbeddingPhase?.('mode_seed', 1);
  const modeSeed = await embedWithCache(provider, cache, [{
    ownerType: 'mode',
    ownerId: `mode-seed:${mode.trim().toLowerCase() || 'default'}`,
    text: seedText,
  }]);
  const seedEmbedding = modeSeed.records[0]?.embedding ?? [];

  const nodeSimilarities = Object.fromEntries(eligibleGraphNodes.map((node) => [
    node.id,
    positiveSimilarity(seedEmbedding, nodeEmbeddingById.get(node.id) ?? []),
  ]));
  const modeProfile = buildSemanticModeProfile(
    state,
    mode,
    nodeSimilarities,
    { minimumSimilarity: options.minimumModeNodeSimilarity ?? 0.2 },
  );
  const semanticModelVersion = `${provider.modelId}@${provider.modelVersion}`;
  modeProfile.model_version = semanticModelVersion;

  const graphCentroid = weightedEmbeddingCentroid(
    eligibleGraphNodes.map((node) => ({
      embedding: nodeEmbeddingById.get(node.id) ?? [],
      weight: graphNodeWeight(node),
    })),
  );
  const modeCentroid = weightedEmbeddingCentroid([
    { embedding: seedEmbedding, weight: 1 },
    ...Object.entries(modeProfile.node_weights).map(([nodeId, weight]) => ({
      embedding: nodeEmbeddingById.get(nodeId) ?? [],
      weight,
    })),
  ]);
  modeProfile.embedding = modeCentroid;

  const candidateInputs = candidates.map((candidate) => ({
    ownerType: 'content' as const,
    ownerId: candidate.external_id,
    text: buildCandidateEmbeddingText(candidate),
  }));
  await options.onEmbeddingPhase?.('candidate_embeddings', candidateInputs.length);
  const candidateEmbeddings = await embedWithCache(provider, cache, candidateInputs);

  const enriched = candidates.map((candidate, index) => {
    const embedding = candidateEmbeddings.records[index]?.embedding ?? [];
    const graphMatches = eligibleGraphNodes
      .map((node) => {
        const similarity = positiveSimilarity(
          embedding,
          nodeEmbeddingById.get(node.id) ?? [],
        );
        return {
          node_id: node.id,
          node_label: node.label,
          similarity,
          rankingWeight: similarity * graphNodeWeight(node),
        };
      })
      .filter((match) => match.similarity > 0)
      .sort((left, right) => (
        right.rankingWeight - left.rankingWeight
        || right.similarity - left.similarity
        || left.node_id.localeCompare(right.node_id)
      ))
      .slice(0, 3);

    const graphSimilarity = graphMatches.length > 0
      ? graphMatches.reduce((sum, match) => sum + match.rankingWeight, 0)
        / graphMatches.reduce((sum, match) => {
          const node = eligibleGraphNodes.find((candidateNode) => candidateNode.id === match.node_id);
          return sum + (node ? graphNodeWeight(node) : 1);
        }, 0)
      : positiveSimilarity(embedding, graphCentroid);

    return {
      ...candidate,
      semantic_similarity: graphSimilarity,
      semantic_graph_similarity: graphSimilarity,
      semantic_mode_similarity: positiveSimilarity(embedding, modeCentroid),
      semantic_model_version: semanticModelVersion,
      semantic_graph_matches: graphMatches.map((match) => ({
        node_id: match.node_id,
        node_label: match.node_label,
        similarity: Number(match.similarity.toFixed(4)),
        weight: Number(match.rankingWeight.toFixed(4)),
      })),
    };
  });

  return {
    candidates: enriched,
    modeProfile,
    diagnostics: {
      modelId: provider.modelId,
      modelVersion: provider.modelVersion,
      graphNodesConsidered: eligibleGraphNodes.length,
      graphEmbeddingsComputed: graphEmbeddings.computed + modeSeed.computed,
      graphEmbeddingsFromCache: graphEmbeddings.fromCache + modeSeed.fromCache,
      candidateEmbeddingsComputed: candidateEmbeddings.computed,
      candidateEmbeddingsFromCache: candidateEmbeddings.fromCache,
      candidateCount: candidates.length,
      modeNodeCount: Object.keys(modeProfile.node_weights).length,
    },
  };
}

export function createMemoryEmbeddingCache(
  initial: Record<string, EmbeddingRecord> = {},
): EmbeddingCache & { snapshot(): Record<string, EmbeddingRecord> } {
  const records = new Map(Object.entries(initial));
  return {
    async get(key) {
      return records.get(key) ?? null;
    },
    async set(key, record) {
      records.set(key, record);
    },
    snapshot() {
      return Object.fromEntries(records);
    },
  };
}
