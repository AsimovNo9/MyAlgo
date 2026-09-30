import type { CandidateAcquisitionProvenance, CandidateModeAffinity, FeedSourceFilters, PersonalAlgorithmState, SemanticCategoryId } from '@repo/shared-types';
import {
  buildCanonicalSemanticConcepts,
  buildPersonalScoringGraphIndex,
  buildPersonalScoringRevisionContext,
  isScoreTraceConsistent,
  scorePersonalAlgorithm,
  type CanonicalSemanticConcept,
  type PersonalScoringPolicy,
  type ScoreCandidate,
  type ScoreFeedbackSignal,
  type ScoreFeatureSignal,
  type ScoreModeFeatureSignal,
  type PersonalScoreTrace,
} from '@repo/recommender-core';

export type LocalRuntimeCandidate = {
  external_id: string;
  title: string;
  firstSeenAt: string;
  lastSeenAt: string;
  channel_name?: string | null;
  channel_id?: string | null;
  description?: string | null;
  duration_seconds?: number | null;
  source_kind?: 'subscription' | 'discovery' | 'liked' | null;
  published_at?: string | null;
  topics?: string[];
  content_type?: string | null;
  language?: string | null;
  format?: string | null;
  is_short?: boolean;
  is_live?: boolean;
  content_label?: 'learning' | 'work' | 'relax' | null;
  content_label_confidence?: number | null;
  semantic_graph_similarity?: number | null;
  semantic_mode_similarity?: number | null;
  semantic_model_version?: string | null;
  semantic_category?: SemanticCategoryId | null;
  semantic_category_confidence?: number | null;
  semantic_category_scores?: Partial<Record<SemanticCategoryId, number>>;
  semantic_mode_affinities?: CandidateModeAffinity[];
  semantic_graph_matches?: Array<{
    node_id: string;
    node_label: string;
    similarity: number;
    weight: number;
    canonical_id?: string;
    source_node_ids?: string[];
    taxonomy_only?: boolean;
    pipeline_id?: string;
  }>;
  provenance?: CandidateAcquisitionProvenance;
  acquisition_history?: CandidateAcquisitionProvenance[];
};

export type LocalRuntimeRankedCandidate = LocalRuntimeCandidate & {
  id: string;
  rawScore: number;
  score: number;
  visible: boolean;
  content_label: 'learning' | 'work' | 'relax' | null;
  content_label_confidence: number;
  trace: PersonalScoreTrace;
};

export type LocalRuntimeFeedbackEvent = {
  contentItemId?: string;
  eventType?: string;
  recordedAt?: string;
  channelId?: string | null;
};

export type LocalDurableModeScoringContext = {
  id: string;
  label: string;
  revision: number;
};

const contentNodeId = (source: string, externalId: string) =>
  `content:${encodeURIComponent(source)}:${encodeURIComponent(externalId)}`;


const FEATURE_WEIGHTS = {
  objective: 18,
  topic: 14,
  concept: 10,
  format: 6,
} as const;

const SEMANTIC_NEIGHBOURHOOD_CONTRIBUTION_CAP = 18;
const GROUNDED_MODE_CONTRIBUTION_CAP = 14;
const TAXONOMY_ONLY_MAX_CONTRIBUTION = 3;
const TAXONOMY_ONLY_WEIGHT_MULTIPLIER = 0.25;
const SEMANTIC_MATCH_MINIMUM_BEST_SIMILARITY = 0.35;
const SEMANTIC_MATCH_MINIMUM_RUNNER_UP_MARGIN = 0.04;
const SEMANTIC_MATCH_MINIMUM_SIMILARITY = 0.24;
const SEMANTIC_MATCH_RELATIVE_TO_BEST = 0.7;

const SEMANTIC_REGION_GENERIC_TOKENS = new Set([
  'ai', 'artificial', 'blog', 'blogs', 'daily', 'education', 'entertainment',
  'game', 'games', 'gameplay', 'guide', 'learning', 'music', 'news', 'people',
  'review', 'tech', 'technology', 'tutorial', 'video', 'videos', 'week',
]);

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'the', 'this', 'to', 'with', 'you', 'your',
]);

const normalizeFeatureText = (value: string | null | undefined): string =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const featureTokens = (value: string | null | undefined): string[] =>
  normalizeFeatureText(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

const containsTokenSequence = (
  fieldTokens: readonly string[],
  labelTokens: readonly string[],
): boolean => {
  if (labelTokens.length === 0 || fieldTokens.length < labelTokens.length) return false;
  for (let start = 0; start <= fieldTokens.length - labelTokens.length; start += 1) {
    let matches = true;
    for (let offset = 0; offset < labelTokens.length; offset += 1) {
      if (fieldTokens[start + offset] !== labelTokens[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
};

type PreparedLexicalText = {
  normalized: string;
  tokens: string[];
};

const prepareLexicalText = (value: string | null | undefined): PreparedLexicalText => {
  const normalized = normalizeFeatureText(value);
  return {
    normalized,
    tokens: normalized ? featureTokens(normalized) : [],
  };
};

const candidateLexicalFields = (candidate: LocalRuntimeCandidate): PreparedLexicalText[] => [
  candidate.title,
  candidate.channel_name ?? '',
  ...(candidate.topics ?? []),
].map(prepareLexicalText).filter((field) => Boolean(field.normalized));

const lexicalMatchPrepared = (
  label: PreparedLexicalText,
  candidateFields: readonly PreparedLexicalText[],
): number => {
  if (!label.normalized || label.tokens.length === 0 || candidateFields.length === 0) return 0;

  for (const field of candidateFields) {
    if (field.normalized.includes(label.normalized)) return 1;
    if (label.tokens.length === 1) {
      if (field.tokens.includes(label.tokens[0]!)) return 1;
      continue;
    }

    // Multi-token concepts must be grounded as one contiguous semantic phrase
    // inside one trusted field. Do not construct a match by combining words
    // scattered across title/description/channel/tags.
    if (containsTokenSequence(field.tokens, label.tokens)) return 1;
  }
  return 0;
};

const lexicalMatch = (
  label: string,
  candidateFields: readonly PreparedLexicalText[],
): number => lexicalMatchPrepared(prepareLexicalText(label), candidateFields);

type LocalScoringIndex = {
  contentNodes: Map<string, PersonalAlgorithmState['graph']['nodes'][number]>;
  creatorByContent: Map<string, string>;
  creatorByLabel: Map<string, string>;
  creatorIds: Set<string>;
  featureNodes: PersonalAlgorithmState['graph']['nodes'];
  featureNodeById: Map<string, PersonalAlgorithmState['graph']['nodes'][number]>;
  featureLexicalById: Map<string, PreparedLexicalText>;
  canonicalConcepts: CanonicalSemanticConcept[];
  canonicalByNodeId: Map<string, CanonicalSemanticConcept>;
  evidenceIdsByNodeId: Map<string, string[]>;
};

type CachedCandidateScore = {
  signature: string;
  modeKey: string;
  feedbackKey: string;
  rawScore: number;
  score: number;
  classification: ReturnType<typeof classifyCandidateContent>;
  trace: PersonalScoreTrace;
};

type PreparedLocalScoringState = {
  policy: PersonalScoringPolicy;
  scoringIndex: LocalScoringIndex;
  graphIndex: ReturnType<typeof buildPersonalScoringGraphIndex>;
  revisionContextByFeedbackKey: Map<string, ReturnType<typeof buildPersonalScoringRevisionContext>>;
  candidateScoreCache: Map<string, CachedCandidateScore>;
};

const preparedLocalScoringState = new WeakMap<PersonalAlgorithmState, PreparedLocalScoringState>();

const feedbackRevisionKey = (signals: readonly ScoreFeedbackSignal[]): string => JSON.stringify(
  signals.map((signal) => ({
    id: signal.id,
    contentId: signal.contentId ?? null,
    nodeId: signal.nodeId ?? null,
    value: signal.value,
    label: signal.label ?? null,
    evidenceIds: [...(signal.evidenceIds ?? [])].sort(),
  })).sort((left, right) => left.id.localeCompare(right.id)),
);

function buildLocalScoringIndex(state: PersonalAlgorithmState): LocalScoringIndex {
  const contentNodes = new Map<string, PersonalAlgorithmState['graph']['nodes'][number]>();
  const creatorByLabel = new Map<string, string>();
  const creatorIds = new Set<string>();
  const featureNodes: PersonalAlgorithmState['graph']['nodes'] = [];

  for (const node of state.graph.nodes) {
    if (node.kind === 'content') contentNodes.set(node.id, node);
    if (node.kind === 'creator') {
      creatorIds.add(node.id);
      const label = node.label.trim().toLowerCase();
      if (label && !creatorByLabel.has(label)) creatorByLabel.set(label, node.id);
    }
    if (['objective', 'topic', 'concept'].includes(node.kind)) featureNodes.push(node);
  }

  const creatorByContent = new Map<string, string>();
  const semanticNodeIds = new Set(featureNodes.map((node) => node.id));
  const evidenceSetsByNodeId = new Map<string, Set<string>>(
    featureNodes.map((node) => [node.id, new Set<string>()]),
  );
  for (const edge of state.graph.edges) {
    if (edge.relation === 'created_by' && creatorIds.has(edge.targetNodeId) && !creatorByContent.has(edge.sourceNodeId)) {
      creatorByContent.set(edge.sourceNodeId, edge.targetNodeId);
    }
    if (semanticNodeIds.has(edge.sourceNodeId)) {
      const evidence = evidenceSetsByNodeId.get(edge.sourceNodeId);
      for (const evidenceId of edge.evidenceIds ?? []) evidence?.add(evidenceId);
    }
    if (semanticNodeIds.has(edge.targetNodeId)) {
      const evidence = evidenceSetsByNodeId.get(edge.targetNodeId);
      for (const evidenceId of edge.evidenceIds ?? []) evidence?.add(evidenceId);
    }
  }
  const evidenceIdsByNodeId = new Map(
    [...evidenceSetsByNodeId.entries()].map(([nodeId, evidence]) => [
      nodeId,
      [...evidence].sort(),
    ]),
  );

  const canonical = buildCanonicalSemanticConcepts(state);
  const canonicalById = new Map(canonical.concepts.map((concept) => [concept.id, concept]));
  const canonicalByNodeId = new Map<string, CanonicalSemanticConcept>();
  for (const [nodeId, canonicalId] of Object.entries(canonical.assignmentByNodeId)) {
    const concept = canonicalById.get(canonicalId);
    if (concept) canonicalByNodeId.set(nodeId, concept);
  }

  return {
    contentNodes,
    creatorByContent,
    creatorByLabel,
    creatorIds,
    featureNodes,
    featureNodeById: new Map(featureNodes.map((node) => [node.id, node])),
    featureLexicalById: new Map(
      featureNodes.map((node) => [node.id, prepareLexicalText(node.label)]),
    ),
    canonicalConcepts: canonical.concepts,
    canonicalByNodeId,
    evidenceIdsByNodeId,
  };
}

const getPreparedLocalScoringState = (
  state: PersonalAlgorithmState,
): PreparedLocalScoringState => {
  let prepared = preparedLocalScoringState.get(state);
  if (prepared) return prepared;
  prepared = {
    policy: buildLocalScoringPolicy(state),
    scoringIndex: buildLocalScoringIndex(state),
    graphIndex: buildPersonalScoringGraphIndex(state),
    revisionContextByFeedbackKey: new Map(),
    candidateScoreCache: new Map(),
  };
  preparedLocalScoringState.set(state, prepared);
  return prepared;
};

const inferredFormat = (candidate: LocalRuntimeCandidate): string | null => {
  if (candidate.is_short) return 'short';
  if (candidate.is_live) return 'live';
  if (candidate.format?.trim()) return normalizeFeatureText(candidate.format);
  const text = normalizeFeatureText(candidate.title);
  if (/\b(podcast|interview)\b/.test(text)) return 'podcast';
  if (/\b(tutorial|course|guide|explained|learn)\b/.test(text)) return 'tutorial';
  if (/\b(album|music|song|mix)\b/.test(text)) return 'music';
  if (/\b(review|benchmark)\b/.test(text)) return 'review';
  return null;
};

type CanonicalSemanticAccumulator = {
  id: string;
  label: string;
  taxonomyOnly: boolean;
  objectiveOnly: boolean;
  explicitProtected: boolean;
  canonicalIds: Set<string>;
  sourceNodeIds: Set<string>;
  evidenceIds: Set<string>;
  lexicalValue: number;
  embeddingValue: number;
};

const semanticLabelsShareScoringRegion = (
  leftLabel: string,
  rightLabel: string,
  sharesEvidence: boolean,
): boolean => {
  const leftTokens = new Set(featureTokens(leftLabel));
  const rightTokens = new Set(featureTokens(rightLabel));
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;

  const shared = [...leftTokens].filter((token) => rightTokens.has(token));
  if (shared.length === 0) return false;
  const containment = shared.length / Math.min(leftTokens.size, rightTokens.size);

  // Strong lexical containment captures nested aliases/subtopics such as
  // "chill lofi" ↔ "chill lofi beats" and
  // "Silent Hill Townfall" ↔ "... PS5 Gameplay".
  if (shared.length >= 2 && containment >= 0.75) return true;

  // A single distinctive token is only enough when both concepts are backed by
  // the same graph evidence. Generic taxonomy/domain words cannot cause a merge.
  return shared.length === 1
    && containment >= 0.5
    && sharesEvidence
    && !SEMANTIC_REGION_GENERIC_TOKENS.has(shared[0]!);
};

const semanticScoringRegionId = (canonicalIds: readonly string[]): string => {
  const input = [...canonicalIds].sort().join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `canonical:semantic:score-region:v1:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const mergeRedundantSemanticAccumulators = (
  input: readonly CanonicalSemanticAccumulator[],
): CanonicalSemanticAccumulator[] => {
  if (input.length <= 1) return [...input];

  const parent = input.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] === index) return index;
    parent[index] = find(parent[index]!);
    return parent[index]!;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };
  const setsShareValue = (left: ReadonlySet<string>, right: ReadonlySet<string>) => {
    for (const value of left) if (right.has(value)) return true;
    return false;
  };

  for (let leftIndex = 0; leftIndex < input.length; leftIndex += 1) {
    const left = input[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < input.length; rightIndex += 1) {
      const right = input[rightIndex]!;
      if (left.taxonomyOnly !== right.taxonomyOnly) continue;
      if (left.objectiveOnly || right.objectiveOnly) continue;
      if (left.explicitProtected || right.explicitProtected) continue;
      if (!semanticLabelsShareScoringRegion(
        left.label,
        right.label,
        setsShareValue(left.evidenceIds, right.evidenceIds),
      )) continue;
      union(leftIndex, rightIndex);
    }
  }

  const groups = new Map<number, CanonicalSemanticAccumulator[]>();
  input.forEach((entry, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(entry);
    groups.set(root, group);
  });

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0]!;
    const representative = [...group].sort((left, right) => (
      Math.max(right.lexicalValue, right.embeddingValue)
      - Math.max(left.lexicalValue, left.embeddingValue)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id)
    ))[0]!;
    const canonicalIds = [...new Set(group.flatMap((entry) => [...entry.canonicalIds]))].sort();
    return {
      id: semanticScoringRegionId(canonicalIds),
      label: representative.label,
      taxonomyOnly: group.every((entry) => entry.taxonomyOnly),
      objectiveOnly: group.every((entry) => entry.objectiveOnly),
      explicitProtected: group.some((entry) => entry.explicitProtected),
      canonicalIds: new Set(canonicalIds),
      sourceNodeIds: new Set(group.flatMap((entry) => [...entry.sourceNodeIds])),
      evidenceIds: new Set(group.flatMap((entry) => [...entry.evidenceIds])),
      lexicalValue: Math.max(...group.map((entry) => entry.lexicalValue)),
      embeddingValue: Math.max(...group.map((entry) => entry.embeddingValue)),
    };
  });
};

const canonicalEvidenceIdsForNodes = (
  sourceNodeIds: Iterable<string>,
  evidenceIdsByNodeId: ReadonlyMap<string, readonly string[]>,
): string[] => [...new Set(
  [...sourceNodeIds].flatMap((nodeId) => evidenceIdsByNodeId.get(nodeId) ?? []),
)].filter(Boolean).sort();

const canonicalByNodeIdFromConcepts = (
  concepts: readonly CanonicalSemanticConcept[],
): Map<string, CanonicalSemanticConcept> => {
  const result = new Map<string, CanonicalSemanticConcept>();
  for (const concept of concepts) {
    for (const nodeId of concept.sourceNodeIds) result.set(nodeId, concept);
  }
  return result;
};

const extractLocalCandidateFeaturesWithCanonical = (
  candidate: LocalRuntimeCandidate,
  featureNodes: PersonalAlgorithmState['graph']['nodes'],
  canonicalByNodeId: ReadonlyMap<string, CanonicalSemanticConcept>,
  evidenceIdsByNodeId: ReadonlyMap<string, readonly string[]>,
  featureNodeById: ReadonlyMap<string, PersonalAlgorithmState['graph']['nodes'][number]> = new Map(
    featureNodes.map((node) => [node.id, node]),
  ),
  featureLexicalById: ReadonlyMap<string, PreparedLexicalText> = new Map(
    featureNodes.map((node) => [node.id, prepareLexicalText(node.label)]),
  ),
): { nodeIds: string[]; features: ScoreFeatureSignal[] } => {
  const lexicalFields = candidateLexicalFields(candidate);
  const nodeIds: string[] = [];
  const features: ScoreFeatureSignal[] = [];
  const matchMetadataByCanonicalId = new Map<string, {
    label: string;
    taxonomyOnly: boolean;
    objectiveOnly: boolean;
    explicitProtected: boolean;
    sourceNodeIds: string[];
  }>();
  const canonicalOverrideByNodeId = new Map<string, string>();
  for (const match of candidate.semantic_graph_matches ?? []) {
    const canonicalId = match.canonical_id?.trim();
    if (!canonicalId) continue;
    const sourceNodeIds = [...new Set(
      (match.source_node_ids?.length ? match.source_node_ids : [match.node_id]).filter(Boolean),
    )].sort();
    matchMetadataByCanonicalId.set(canonicalId, {
      label: match.node_label,
      taxonomyOnly: Boolean(match.taxonomy_only),
      objectiveOnly: sourceNodeIds.length > 0 && sourceNodeIds.every((nodeId) => (
        canonicalByNodeId.get(nodeId)?.kinds.every((kind) => kind === 'objective') === true
      )),
      explicitProtected: sourceNodeIds.some((nodeId) => {
        const provenance = canonicalByNodeId.get(nodeId)?.provenance;
        return provenance === 'explicit' || provenance === 'mixed';
      }),
      sourceNodeIds,
    });
    for (const nodeId of sourceNodeIds) canonicalOverrideByNodeId.set(nodeId, canonicalId);
  }

  const accumulators = new Map<string, CanonicalSemanticAccumulator>();
  const ensureAccumulator = (
    canonicalId: string,
    label: string,
    taxonomyOnly: boolean,
    objectiveOnly: boolean,
    explicitProtected: boolean,
    sourceNodeIds: readonly string[],
  ): CanonicalSemanticAccumulator => {
    const existing = accumulators.get(canonicalId);
    if (existing) {
      sourceNodeIds.forEach((nodeId) => existing.sourceNodeIds.add(nodeId));
      canonicalEvidenceIdsForNodes(sourceNodeIds, evidenceIdsByNodeId)
        .forEach((evidenceId) => existing.evidenceIds.add(evidenceId));
      existing.taxonomyOnly = existing.taxonomyOnly && taxonomyOnly;
      existing.objectiveOnly = existing.objectiveOnly && objectiveOnly;
      existing.explicitProtected = existing.explicitProtected || explicitProtected;
      existing.canonicalIds.add(canonicalId);
      return existing;
    }
    const created: CanonicalSemanticAccumulator = {
      id: canonicalId,
      label,
      taxonomyOnly,
      objectiveOnly,
      explicitProtected,
      canonicalIds: new Set([canonicalId]),
      sourceNodeIds: new Set(sourceNodeIds),
      evidenceIds: new Set(canonicalEvidenceIdsForNodes(sourceNodeIds, evidenceIdsByNodeId)),
      lexicalValue: 0,
      embeddingValue: 0,
    };
    accumulators.set(canonicalId, created);
    return created;
  };

  for (const node of featureNodes) {
    if (!['objective', 'topic', 'concept'].includes(node.kind)) continue;
    const similarity = lexicalMatchPrepared(
      featureLexicalById.get(node.id) ?? prepareLexicalText(node.label),
      lexicalFields,
    );
    if (similarity <= 0) continue;
    const confidence = Math.min(
      1,
      Math.max(
        0,
        typeof node.confidence === 'number' && Number.isFinite(node.confidence)
          ? node.confidence
          : 1,
      ),
    );
    const weight = FEATURE_WEIGHTS[node.kind as keyof typeof FEATURE_WEIGHTS];
    const lexicalValue = Number((weight * similarity * confidence).toFixed(2));
    if (lexicalValue <= 0) continue;

    const deterministic = canonicalByNodeId.get(node.id);
    const overrideId = canonicalOverrideByNodeId.get(node.id);
    const canonicalId = overrideId ?? deterministic?.id ?? `canonical:semantic:raw:${node.id}`;
    const overrideMetadata = overrideId ? matchMetadataByCanonicalId.get(overrideId) : undefined;
    const sourceNodeIds = overrideMetadata?.sourceNodeIds
      ?? deterministic?.sourceNodeIds
      ?? [node.id];
    const accumulator = ensureAccumulator(
      canonicalId,
      overrideMetadata?.label ?? deterministic?.label ?? node.label,
      overrideMetadata?.taxonomyOnly ?? deterministic?.taxonomyOnly ?? false,
      overrideMetadata?.objectiveOnly
        ?? deterministic?.kinds.every((kind) => kind === 'objective')
        ?? node.kind === 'objective',
      overrideMetadata?.explicitProtected
        ?? (
          deterministic?.provenance === 'explicit'
          || deterministic?.provenance === 'mixed'
        ),
      sourceNodeIds,
    );
    accumulator.lexicalValue = Math.max(accumulator.lexicalValue, lexicalValue);
    nodeIds.push(node.id);
  }

  const graphSimilarity = Number(candidate.semantic_graph_similarity ?? 0);
  if (Number.isFinite(graphSimilarity) && graphSimilarity >= 0.2) {
    const rawSemanticMatches = (candidate.semantic_graph_matches ?? [])
      .filter((match) => Number.isFinite(match.similarity) && match.similarity > 0);
    const rankedSemanticMatches = [...rawSemanticMatches]
      .sort((left, right) => right.similarity - left.similarity || left.node_label.localeCompare(right.node_label));
    const bestSemanticMatch = rankedSemanticMatches[0];
    const bestSemanticSimilarity = bestSemanticMatch?.similarity ?? 0;
    const independentRunnerUp = bestSemanticMatch
      ? rankedSemanticMatches.slice(1).find((match) => !semanticLabelsShareScoringRegion(
        bestSemanticMatch.node_label,
        match.node_label,
        false,
      ))
      : undefined;
    const independentRunnerUpSimilarity = independentRunnerUp?.similarity ?? 0;
    const embeddingProfileQualified = bestSemanticSimilarity >= SEMANTIC_MATCH_MINIMUM_BEST_SIMILARITY
      && (
        bestSemanticSimilarity - independentRunnerUpSimilarity
        >= SEMANTIC_MATCH_MINIMUM_RUNNER_UP_MARGIN
      );
    const groupedMatches = new Map<string, {
      id: string;
      label: string;
      taxonomyOnly: boolean;
      objectiveOnly: boolean;
      sourceNodeIds: string[];
      weight: number;
    }>();

    for (const match of rawSemanticMatches) {
      const sourceNodeIdsForSupport = match.source_node_ids?.length
        ? match.source_node_ids
        : [match.node_id];
      const hasLexicalSupport = lexicalMatch(match.node_label, lexicalFields) > 0
        || sourceNodeIdsForSupport.some((nodeId) => (
          lexicalMatchPrepared(
            featureLexicalById.get(nodeId)
              ?? prepareLexicalText(featureNodeById.get(nodeId)?.label ?? ''),
            lexicalFields,
          ) > 0
        ));
      if (!hasLexicalSupport && (
        !embeddingProfileQualified
        || match.similarity < SEMANTIC_MATCH_MINIMUM_SIMILARITY
        || match.similarity < bestSemanticSimilarity * SEMANTIC_MATCH_RELATIVE_TO_BEST
      )) continue;
      const deterministic = canonicalByNodeId.get(match.node_id);
      const canonicalId = match.canonical_id?.trim()
        || deterministic?.id
        || `canonical:semantic:raw:${match.node_id}`;
      const sourceNodeIds = [...new Set(
        (match.source_node_ids?.length
          ? match.source_node_ids
          : deterministic?.sourceNodeIds ?? [match.node_id]).filter(Boolean),
      )].sort();
      const weight = Number.isFinite(match.weight) && match.weight > 0
        ? match.weight
        : match.similarity;
      const existing = groupedMatches.get(canonicalId);
      if (existing) {
        existing.weight += weight;
        existing.sourceNodeIds = [...new Set([...existing.sourceNodeIds, ...sourceNodeIds])].sort();
        existing.taxonomyOnly = existing.taxonomyOnly && Boolean(
          match.taxonomy_only ?? deterministic?.taxonomyOnly,
        );
        existing.objectiveOnly = existing.objectiveOnly && Boolean(
          deterministic?.kinds.every((kind) => kind === 'objective'),
        );
      } else {
        groupedMatches.set(canonicalId, {
          id: canonicalId,
          label: match.node_label || deterministic?.label || match.node_id,
          taxonomyOnly: Boolean(match.taxonomy_only ?? deterministic?.taxonomyOnly),
          objectiveOnly: Boolean(
            deterministic?.kinds.every((kind) => kind === 'objective'),
          ),
          sourceNodeIds,
          weight,
        });
      }
    }

    const grouped = [...groupedMatches.values()];
    const totalWeight = grouped.reduce((sum, match) => sum + match.weight, 0);
    const semanticValue = 18 * Math.min(1, graphSimilarity);
    if (totalWeight > 0) {
      for (const match of grouped) {
        const explicitProtected = match.sourceNodeIds.some((nodeId) => {
          const provenance = canonicalByNodeId.get(nodeId)?.provenance;
          return provenance === 'explicit' || provenance === 'mixed';
        });
        const accumulator = ensureAccumulator(
          match.id,
          match.label,
          match.taxonomyOnly,
          match.objectiveOnly,
          explicitProtected,
          match.sourceNodeIds,
        );
        accumulator.embeddingValue = Math.max(
          accumulator.embeddingValue,
          Number((semanticValue * (match.weight / totalWeight)).toFixed(2)),
        );
      }
    }
  }

  const reconciledAccumulators = mergeRedundantSemanticAccumulators(
    [...accumulators.values()],
  );
  const hasSpecificSemanticMatch = reconciledAccumulators
    .some((entry) => !entry.taxonomyOnly && Math.max(entry.lexicalValue, entry.embeddingValue) > 0);
  const rankedSemantic = reconciledAccumulators
    .map((entry) => ({
      ...entry,
      combinedValue: Math.max(entry.lexicalValue, entry.embeddingValue),
    }))
    .filter((entry) => entry.combinedValue > 0)
    .sort((left, right) => (
      Number(left.taxonomyOnly) - Number(right.taxonomyOnly)
      || right.combinedValue - left.combinedValue
      || left.id.localeCompare(right.id)
    ));

  const taxonomyEntries = rankedSemantic.filter((entry) => entry.taxonomyOnly);
  const semanticEntries = rankedSemantic.filter((entry) => !entry.taxonomyOnly);
  if (!hasSpecificSemanticMatch && taxonomyEntries.length > 0) {
    const representative = taxonomyEntries[0]!;
    semanticEntries.push({
      ...representative,
      id: semanticScoringRegionId(
        [...new Set(taxonomyEntries.flatMap((entry) => [...entry.canonicalIds]))].sort(),
      ),
      sourceNodeIds: new Set(taxonomyEntries.flatMap((entry) => [...entry.sourceNodeIds])),
      evidenceIds: new Set(taxonomyEntries.flatMap((entry) => [...entry.evidenceIds])),
      combinedValue: Math.max(...taxonomyEntries.map((entry) => entry.combinedValue)),
    });
  }

  for (const entry of semanticEntries) {
    const adjusted = entry.taxonomyOnly
      ? Math.min(
        TAXONOMY_ONLY_MAX_CONTRIBUTION,
        entry.combinedValue * TAXONOMY_ONLY_WEIGHT_MULTIPLIER,
      )
      : entry.combinedValue;
    const value = Number(Math.min(
      SEMANTIC_NEIGHBOURHOOD_CONTRIBUTION_CAP,
      adjusted,
    ).toFixed(2));
    if (value <= 0) continue;
    features.push({
      id: `semantic-neighbourhood:${entry.id}`,
      label: entry.objectiveOnly
        ? `objective match: ${entry.label}`
        : entry.taxonomyOnly
          ? `semantic taxonomy: ${entry.label}`
          : `semantic neighbourhood: ${entry.label}`,
      value,
      sourceId: entry.id,
      sourceIds: [...entry.sourceNodeIds].sort(),
      evidenceIds: [...entry.evidenceIds].sort(),
    });
  }

  const format = inferredFormat(candidate);
  if (format) {
    const formatNode = featureNodes
      .find((node) => ['objective', 'topic', 'concept'].includes(node.kind) && normalizeFeatureText(
        typeof node.attributes?.format === 'string' ? node.attributes.format : '',
      ) === format);
    if (formatNode) {
      const confidence = Math.min(1, Math.max(0, typeof formatNode.confidence === 'number' && Number.isFinite(formatNode.confidence) ? formatNode.confidence : 1));
      features.push({
        id: `format:${formatNode.id}:${format}`,
        label: `format match: ${format}`,
        value: Number((FEATURE_WEIGHTS.format * confidence).toFixed(2)),
        sourceId: formatNode.id,
        sourceIds: [formatNode.id],
      });
      nodeIds.push(formatNode.id);
    }
  }

  if (candidate.published_at && candidate.lastSeenAt) {
    const published = new Date(candidate.published_at).getTime();
    const observed = new Date(candidate.lastSeenAt).getTime();
    if (Number.isFinite(published) && Number.isFinite(observed) && observed >= published) {
      const ageDays = (observed - published) / (24 * 60 * 60 * 1000);
      const freshness = ageDays <= 1 ? 4 : ageDays <= 7 ? 2.5 : ageDays <= 30 ? 1 : 0;
      if (freshness > 0) {
        features.push({
          id: 'freshness',
          label: ageDays <= 1 ? 'freshness: published today' : ageDays <= 7 ? 'freshness: published this week' : 'freshness: published this month',
          value: freshness,
        });
      }
    }
  }

  return {
    nodeIds: [...new Set(nodeIds)].sort(),
    features: features.sort((left, right) => left.id.localeCompare(right.id)),
  };
};

export function extractLocalCandidateFeatures(
  state: PersonalAlgorithmState,
  candidate: LocalRuntimeCandidate,
  featureNodes: PersonalAlgorithmState['graph']['nodes'] = state.graph.nodes,
): { nodeIds: string[]; features: ScoreFeatureSignal[] } {
  const canonical = buildCanonicalSemanticConcepts(state);
  const evidenceIdsByNodeId = new Map<string, string[]>(
    featureNodes.map((node) => [node.id, []]),
  );
  for (const edge of state.graph.edges) {
    for (const nodeId of [edge.sourceNodeId, edge.targetNodeId]) {
      if (!evidenceIdsByNodeId.has(nodeId)) continue;
      evidenceIdsByNodeId.set(nodeId, [
        ...new Set([
          ...(evidenceIdsByNodeId.get(nodeId) ?? []),
          ...(edge.evidenceIds ?? []),
        ]),
      ].sort());
    }
  }
  return extractLocalCandidateFeaturesWithCanonical(
    candidate,
    featureNodes,
    canonicalByNodeIdFromConcepts(canonical.concepts),
    evidenceIdsByNodeId,
  );
}

export function classifyCandidateContent(
  candidate: LocalRuntimeCandidate,
): { label: 'learning' | 'work' | 'relax' | null; confidence: number } {
  const category = normalizeFeatureText(candidate.content_type);
  const format = inferredFormat(candidate);
  const text = normalizeFeatureText([
    candidate.title,
    candidate.description ?? '',
    ...(candidate.topics ?? []),
  ].join(' '));

  if (
    category === 'education'
    || format === 'tutorial'
    || /\b(tutorial|course|lecture|lesson|explainer|explained|learn|study|masterclass|how to)\b/.test(text)
  ) {
    return {
      label: 'learning',
      confidence: category === 'education' || format === 'tutorial' ? 0.92 : 0.78,
    };
  }

  if (
    /\b(music|comedy|asmr|ambient|gameplay|trailer|highlights|funny|vlog)\b/.test(text)
    || ['music', 'comedy', 'entertainment', 'gaming'].includes(category)
  ) {
    return {
      label: 'relax',
      confidence: ['music', 'comedy', 'entertainment', 'gaming'].includes(category) ? 0.86 : 0.74,
    };
  }

  if (/\b(implementation|architecture|engineering|programming|coding|workflow|productivity|business|case study|debugging|developer)\b/.test(text)) {
    return { label: 'work', confidence: 0.72 };
  }

  return { label: null, confidence: 0 };
}

const semanticAlignmentFeatures = (
  candidate: LocalRuntimeCandidate,
  mode: string,
  allowLegacyModeSignals = true,
): ScoreFeatureSignal[] => {
  const features: ScoreFeatureSignal[] = [];
  const modeSimilarity = Number(candidate.semantic_mode_similarity ?? 0);

  const activeMode = mode.trim().toLowerCase();
  const hasActiveMode = Boolean(activeMode && activeMode !== 'default');

  if (allowLegacyModeSignals && hasActiveMode && Number.isFinite(modeSimilarity) && modeSimilarity >= 0.2) {
    features.push({
      id: 'semantic:mode',
      label: 'semantic match: active mode',
      value: Number((14 * Math.min(1, modeSimilarity)).toFixed(2)),
      sourceId: candidate.semantic_model_version
        ? `embedding:${candidate.semantic_model_version}`
        : 'embedding',
    });
  }

  // Category affinity is only applied when the active inferred mode matches a
  // graph-derived category strongly enough to beat the alternatives.
  const scores = candidate.semantic_category_scores;
  const scoreEntries = Object.entries(scores ?? {});
  const activeEntry = allowLegacyModeSignals && hasActiveMode
    ? scoreEntries.find(([category]) => category.trim().toLowerCase() === activeMode)
    : undefined;
  if (activeEntry) {
    const active = Number(activeEntry[1] ?? 0);
    const strongestOther = Math.max(0, ...scoreEntries
      .filter(([category]) => category.trim().toLowerCase() !== activeMode)
      .map(([, similarity]) => Number(similarity ?? 0)));
    if (active >= 0.35 && active - strongestOther >= 0.04) {
      features.push({
        id: 'semantic:category:active',
        label: `semantic category: ${activeEntry[0]}`,
        value: Number((24 * Math.min(1, (active - strongestOther) / 0.12)).toFixed(2)),
        sourceId: candidate.semantic_model_version
          ? `embedding:${candidate.semantic_model_version}`
          : 'embedding',
      });
    }
  }

  return features;
};

const modeAlignmentFeature = (
  mode: string,
  classification: ReturnType<typeof classifyCandidateContent>,
): ScoreFeatureSignal | null => {
  const normalizedMode = mode.trim().toLowerCase();
  if (!classification.label || classification.confidence < 0.7 || normalizedMode !== classification.label) {
    return null;
  }
  const value = classification.label === 'learning' ? 8 : classification.label === 'work' ? 6 : 5;
  return {
    id: `mode-alignment:${classification.label}`,
    label: `mode alignment: ${classification.label}`,
    value: Number((value * classification.confidence).toFixed(2)),
    sourceId: `mode:${classification.label}`,
  };
}

const roundModeValue = (value: number): number => Number(value.toFixed(2));

const groundedDurableModeFeatures = (
  candidate: LocalRuntimeCandidate,
  index: LocalScoringIndex,
  activeMode: LocalDurableModeScoringContext | null | undefined,
): ScoreModeFeatureSignal[] => {
  if (!activeMode || activeMode.id === 'default') return [];
  const affinity = candidate.semantic_mode_affinities?.find((entry) => (
    entry.modeId === activeMode.id
    && entry.modeRevision === activeMode.revision
  ));
  const members = affinity?.memberAffinities
    ?.map((member) => ({
      ...member,
      sourceNodeIds: member.sourceNodeIds.filter((nodeId) => (
        index.evidenceIdsByNodeId.has(nodeId)
      )),
    }))
    .filter((member) => member.weightedAffinity > 0 && member.sourceNodeIds.length > 0)
    .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId)) ?? [];
  if (!affinity || members.length === 0) return [];

  // Recompute the aggregate from members that still resolve to the current
  // graph. Do not transfer score mass from a removed/stale strongest member to
  // weaker surviving members.
  const groundedAffinity = Math.max(
    0,
    ...members.map((member) => Math.max(0, Math.min(1, member.weightedAffinity))),
  );
  const total = roundModeValue(
    GROUNDED_MODE_CONTRIBUTION_CAP * groundedAffinity,
  );
  if (total <= 0) return [];
  const weightTotal = members.reduce(
    (sum, member) => sum + Math.max(0, member.weightedAffinity),
    0,
  );
  if (weightTotal <= 0) return [];

  let allocated = 0;
  return members.map((member, memberIndex) => {
    const value = memberIndex === members.length - 1
      ? roundModeValue(total - allocated)
      : roundModeValue(total * (member.weightedAffinity / weightTotal));
    allocated = roundModeValue(allocated + value);
    const evidenceIds = [...new Set(
      member.sourceNodeIds.flatMap((nodeId) => index.evidenceIdsByNodeId.get(nodeId) ?? []),
    )].sort();

    return {
      id: `durable:${activeMode.id}:r${activeMode.revision}:${member.canonicalId}`,
      label: `mode: ${activeMode.label} → canonical concept: ${member.label}`,
      value,
      sourceId: member.canonicalId,
      sourceIds: [...member.sourceNodeIds].sort(),
      evidenceIds,
      modeId: activeMode.id,
      modeRevision: activeMode.revision,
      canonicalId: member.canonicalId,
    };
  }).filter((feature) => feature.value !== 0);
};

export function calibrateLocalScore(rawScore: number): number {
  if (!Number.isFinite(rawScore)) return 0;
  return Math.max(0, Math.min(100, Math.round(50 + 50 * Math.tanh(rawScore / 30))));
}

const candidateContext = (
  state: PersonalAlgorithmState,
  candidate: LocalRuntimeCandidate,
  index: LocalScoringIndex = buildLocalScoringIndex(state),
  mode = 'default',
  activeDurableMode?: LocalDurableModeScoringContext | null,
  classification: ReturnType<typeof classifyCandidateContent> = classifyCandidateContent(candidate),
): ScoreCandidate => {
  const contentId = contentNodeId('youtube', candidate.external_id);
  const contentNode = index.contentNodes.get(contentId);
  const extracted = extractLocalCandidateFeaturesWithCanonical(
    candidate,
    index.featureNodes,
    index.canonicalByNodeId,
    index.evidenceIdsByNodeId,
    index.featureNodeById,
    index.featureLexicalById,
  );
  const hasDurableMode = Boolean(activeDurableMode && activeDurableMode.id !== 'default');
  // Durable modes use only graph-grounded member contributions. Legacy
  // classifier/centroid/category mode signals remain available for custom
  // non-durable mode values but must not stack beside a stable mode ID.
  if (!hasDurableMode) {
    const modeFeature = candidate.semantic_mode_similarity == null
      ? modeAlignmentFeature(mode, classification)
      : null;
    if (modeFeature) extracted.features.push(modeFeature);
  }
  extracted.features.push(...semanticAlignmentFeatures(candidate, mode, !hasDurableMode));
  const durableModeFeatures = groundedDurableModeFeatures(
    candidate,
    index,
    activeDurableMode,
  );
  const channelCreatorId = candidate.channel_id
    ? `creator:youtube:${encodeURIComponent(candidate.channel_id)}`
    : null;
  const creatorNodeId = index.creatorByContent.get(contentId)
    ?? (channelCreatorId && index.creatorIds.has(channelCreatorId) ? channelCreatorId : null)
    ?? (candidate.channel_name
      ? index.creatorByLabel.get(candidate.channel_name.trim().toLowerCase()) ?? null
      : null);

  return {
    id: `youtube:${candidate.external_id}`,
    content: { source: 'youtube', externalId: candidate.external_id },
    nodeIds: [...new Set([...(contentNode ? [contentNode.id] : []), ...extracted.nodeIds])],
    creatorNodeId,
    features: extracted.features,
    modeFeatures: durableModeFeatures,
  };
};

export function buildLocalScoringPolicy(state: PersonalAlgorithmState): PersonalScoringPolicy {
  const nodeWeights: Record<string, number> = {};
  for (const node of state.graph.nodes) {
    if (node.kind === 'content') nodeWeights[node.id] = 1;
    if (node.kind === 'creator') nodeWeights[node.id] = 8;
  }

  return {
    revision: 'local-mvp-p7',
    baseScore: 0,
    nodeWeights,
    edgeRelationWeights: {
      created_by: 2,
    },
  };
}

export function buildLocalFeedbackSignals(
  events: LocalRuntimeFeedbackEvent[],
  state?: PersonalAlgorithmState,
): ScoreFeedbackSignal[] {
  const scoringIndex = state ? getPreparedLocalScoringState(state).scoringIndex : null;
  const latestByContent = new Map<string, LocalRuntimeFeedbackEvent>();
  events.forEach((event, index) => {
    if (!event.contentItemId || !event.eventType) return;
    const key = event.contentItemId;
    const previous = latestByContent.get(key);
    if (
      !previous
      || (event.recordedAt ?? '').localeCompare(previous.recordedAt ?? '') >= 0
      || (!event.recordedAt && !previous.recordedAt && index >= 0)
    ) {
      latestByContent.set(key, event);
    }
  });

  return [...latestByContent.values()]
    .map((event) => {
      const contentId = event.contentItemId ?? null;
      const contentNodeIdValue = contentNodeId('youtube', contentId ?? '');
      const contentNode = scoringIndex?.contentNodes.get(contentNodeIdValue);
      const creatorNodeId = contentNode
        ? scoringIndex?.creatorByContent.get(contentNode.id) ?? null
        : null;
      const nodeId = event.eventType === 'never_show_channel'
        ? (
          event.channelId
            ? `creator:youtube:${encodeURIComponent(event.channelId)}`
            : creatorNodeId
        )
        : null;
      const value = event.eventType === 'more_like_this'
        ? 20
        : event.eventType === 'not_interested'
          ? -25
          : event.eventType === 'never_show_channel'
            ? -100
            : 0;
      return {
        id: `local-feedback:${contentId}:${event.eventType}`,
        contentId,
        nodeId,
        value,
        label: `explicit feedback: ${event.eventType}`,
      };
    })
    .filter((signal) => signal.value !== 0);
}

const candidateScoringSignature = (candidate: LocalRuntimeCandidate): string => JSON.stringify({
  external_id: candidate.external_id,
  title: candidate.title,
  channel_name: candidate.channel_name ?? null,
  channel_id: candidate.channel_id ?? null,
  description: candidate.description ?? null,
  duration_seconds: candidate.duration_seconds ?? null,
  published_at: candidate.published_at ?? null,
  topics: candidate.topics ?? [],
  content_type: candidate.content_type ?? null,
  language: candidate.language ?? null,
  format: candidate.format ?? null,
  is_short: candidate.is_short ?? false,
  is_live: candidate.is_live ?? false,
  content_label: candidate.content_label ?? null,
  content_label_confidence: candidate.content_label_confidence ?? null,
  semantic_graph_similarity: candidate.semantic_graph_similarity ?? null,
  semantic_mode_similarity: candidate.semantic_mode_similarity ?? null,
  semantic_model_version: candidate.semantic_model_version ?? null,
  semantic_category: candidate.semantic_category ?? null,
  semantic_category_confidence: candidate.semantic_category_confidence ?? null,
  semantic_category_scores: candidate.semantic_category_scores ?? {},
  semantic_mode_affinities: candidate.semantic_mode_affinities ?? [],
  semantic_graph_matches: candidate.semantic_graph_matches ?? [],
});

const durableModeScoringKey = (
  mode: string,
  activeDurableMode?: LocalDurableModeScoringContext | null,
): string => activeDurableMode && activeDurableMode.id !== 'default'
  ? `${activeDurableMode.id}@${activeDurableMode.revision}`
  : `legacy:${mode.trim().toLowerCase() || 'default'}`;

export function scoreLocalCandidates(
  state: PersonalAlgorithmState,
  candidates: LocalRuntimeCandidate[],
  mode: string,
  feedbackSignals: ScoreFeedbackSignal[] = [],
  sourceFilters: FeedSourceFilters = {},
  activeDurableMode?: LocalDurableModeScoringContext | null,
): LocalRuntimeRankedCandidate[] {
  const prepared = getPreparedLocalScoringState(state);
  const feedbackKey = feedbackRevisionKey(feedbackSignals);
  let revisionContext = prepared.revisionContextByFeedbackKey.get(feedbackKey);
  if (!revisionContext) {
    revisionContext = buildPersonalScoringRevisionContext(state, feedbackSignals);
    prepared.revisionContextByFeedbackKey.set(feedbackKey, revisionContext);
  }
  const {
    policy,
    scoringIndex,
    graphIndex,
  } = prepared;

  const modeKey = durableModeScoringKey(mode, activeDurableMode);
  return candidates
    .map((candidate) => {
      const signature = candidateScoringSignature(candidate);
      const cached = prepared.candidateScoreCache.get(candidate.external_id);
      let scoreResult = cached;
      if (
        !scoreResult
        || scoreResult.signature !== signature
        || scoreResult.modeKey !== modeKey
        || scoreResult.feedbackKey !== feedbackKey
      ) {
        const classification = classifyCandidateContent(candidate);
        const context = candidateContext(
          state,
          candidate,
          scoringIndex,
          mode,
          activeDurableMode,
          classification,
        );
        const result = scorePersonalAlgorithm(
          state,
          context,
          policy,
          mode,
          feedbackSignals,
          revisionContext,
          graphIndex,
        );
        if (!isScoreTraceConsistent(result.trace)) {
          throw new Error(`Local score trace is inconsistent for ${candidate.external_id}`);
        }
        scoreResult = {
          signature,
          modeKey,
          feedbackKey,
          rawScore: result.score,
          score: calibrateLocalScore(result.score),
          classification,
          trace: result.trace,
        };
        prepared.candidateScoreCache.set(candidate.external_id, scoreResult);
      }

      const visible = !(
        (candidate.is_short && sourceFilters.includeShorts === false)
        || (candidate.is_live && sourceFilters.includeLive === false)
        || (sourceFilters.subscribedOnly === true && candidate.source_kind !== 'subscription')
        || (sourceFilters.includeDiscovery === false && candidate.source_kind === 'discovery')
      );

      return {
        ...candidate,
        id: candidate.external_id,
        rawScore: scoreResult.rawScore,
        score: scoreResult.score,
        visible,
        content_label: candidate.content_label ?? scoreResult.classification.label,
        content_label_confidence:
          candidate.content_label_confidence ?? scoreResult.classification.confidence,
        trace: scoreResult.trace,
      };
    })
    .sort((left, right) => right.score - left.score || right.rawScore - left.rawScore || left.external_id.localeCompare(right.external_id));
}

export function traceForLocalCandidate(
  state: PersonalAlgorithmState,
  candidate: LocalRuntimeCandidate,
  mode: string,
  feedbackSignals: ScoreFeedbackSignal[] = [],
  activeDurableMode?: LocalDurableModeScoringContext | null,
): PersonalScoreTrace {
  const policy = buildLocalScoringPolicy(state);
  const result = scorePersonalAlgorithm(
    state,
    candidateContext(state, candidate, buildLocalScoringIndex(state), mode, activeDurableMode),
    policy,
    mode,
    feedbackSignals,
  );
  if (!isScoreTraceConsistent(result.trace)) {
    throw new Error(`Local score trace is inconsistent for ${candidate.external_id}`);
  }
  return result.trace;
}
