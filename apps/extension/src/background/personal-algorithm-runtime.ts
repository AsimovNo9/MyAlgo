import type { CandidateAcquisitionProvenance, FeedSourceFilters, PersonalAlgorithmState, SemanticCategoryId } from '@repo/shared-types';
import {
  buildCanonicalSemanticConcepts,
  buildPersonalScoringRevisionContext,
  isScoreTraceConsistent,
  scorePersonalAlgorithm,
  type CanonicalSemanticConcept,
  type PersonalScoringPolicy,
  type ScoreCandidate,
  type ScoreFeedbackSignal,
  type ScoreFeatureSignal,
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

const contentNodeId = (source: string, externalId: string) =>
  `content:${encodeURIComponent(source)}:${encodeURIComponent(externalId)}`;


const FEATURE_WEIGHTS = {
  objective: 18,
  topic: 14,
  concept: 10,
  format: 6,
} as const;

const SEMANTIC_NEIGHBOURHOOD_CONTRIBUTION_CAP = 18;
const TAXONOMY_ONLY_MAX_CONTRIBUTION = 3;
const TAXONOMY_ONLY_WEIGHT_MULTIPLIER = 0.25;

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

const lexicalMatch = (label: string, candidateText: string): number => {
  const normalizedLabel = normalizeFeatureText(label);
  if (!normalizedLabel || !candidateText) return 0;
  if (candidateText.includes(normalizedLabel)) return 1;
  const labelTokens = featureTokens(normalizedLabel);
  if (labelTokens.length === 0) return 0;
  const candidateTokens = new Set(featureTokens(candidateText));
  const overlap = labelTokens.filter((token) => candidateTokens.has(token)).length;
  const ratio = overlap / labelTokens.length;
  return ratio >= 0.5 ? ratio : 0;
};

type LocalScoringIndex = {
  contentNodes: Map<string, PersonalAlgorithmState['graph']['nodes'][number]>;
  creatorByContent: Map<string, string>;
  creatorByLabel: Map<string, string>;
  creatorIds: Set<string>;
  featureNodes: PersonalAlgorithmState['graph']['nodes'];
  canonicalConcepts: CanonicalSemanticConcept[];
  canonicalByNodeId: Map<string, CanonicalSemanticConcept>;
};

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
  for (const edge of state.graph.edges) {
    if (edge.relation === 'created_by' && creatorIds.has(edge.targetNodeId) && !creatorByContent.has(edge.sourceNodeId)) {
      creatorByContent.set(edge.sourceNodeId, edge.targetNodeId);
    }
  }

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
    canonicalConcepts: canonical.concepts,
    canonicalByNodeId,
  };
}

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
  sourceNodeIds: Set<string>;
  evidenceIds: Set<string>;
  lexicalValue: number;
  embeddingValue: number;
};

const canonicalEvidenceIdsForNodes = (
  state: PersonalAlgorithmState,
  sourceNodeIds: Iterable<string>,
): string[] => {
  const ids = new Set(sourceNodeIds);
  return [...new Set(state.graph.edges
    .filter((edge) => ids.has(edge.sourceNodeId) || ids.has(edge.targetNodeId))
    .flatMap((edge) => edge.evidenceIds ?? []))]
    .filter(Boolean)
    .sort();
};

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
  state: PersonalAlgorithmState,
  candidate: LocalRuntimeCandidate,
  featureNodes: PersonalAlgorithmState['graph']['nodes'],
  canonicalByNodeId: ReadonlyMap<string, CanonicalSemanticConcept>,
): { nodeIds: string[]; features: ScoreFeatureSignal[] } => {
  const text = normalizeFeatureText([
    candidate.title,
    candidate.description ?? '',
    candidate.channel_name ?? '',
    ...(candidate.topics ?? []),
  ].join(' '));
  const nodeIds: string[] = [];
  const features: ScoreFeatureSignal[] = [];

  const matchMetadataByCanonicalId = new Map<string, {
    label: string;
    taxonomyOnly: boolean;
    objectiveOnly: boolean;
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
    sourceNodeIds: readonly string[],
  ): CanonicalSemanticAccumulator => {
    const existing = accumulators.get(canonicalId);
    if (existing) {
      sourceNodeIds.forEach((nodeId) => existing.sourceNodeIds.add(nodeId));
      canonicalEvidenceIdsForNodes(state, sourceNodeIds)
        .forEach((evidenceId) => existing.evidenceIds.add(evidenceId));
      existing.taxonomyOnly = existing.taxonomyOnly && taxonomyOnly;
      existing.objectiveOnly = existing.objectiveOnly && objectiveOnly;
      return existing;
    }
    const created: CanonicalSemanticAccumulator = {
      id: canonicalId,
      label,
      taxonomyOnly,
      objectiveOnly,
      sourceNodeIds: new Set(sourceNodeIds),
      evidenceIds: new Set(canonicalEvidenceIdsForNodes(state, sourceNodeIds)),
      lexicalValue: 0,
      embeddingValue: 0,
    };
    accumulators.set(canonicalId, created);
    return created;
  };

  for (const node of featureNodes) {
    if (!['objective', 'topic', 'concept'].includes(node.kind)) continue;
    const similarity = lexicalMatch(node.label, text);
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
      sourceNodeIds,
    );
    accumulator.lexicalValue = Math.max(accumulator.lexicalValue, lexicalValue);
    nodeIds.push(node.id);
  }

  const graphSimilarity = Number(candidate.semantic_graph_similarity ?? 0);
  if (Number.isFinite(graphSimilarity) && graphSimilarity >= 0.2) {
    const groupedMatches = new Map<string, {
      id: string;
      label: string;
      taxonomyOnly: boolean;
      objectiveOnly: boolean;
      sourceNodeIds: string[];
      weight: number;
    }>();

    for (const match of candidate.semantic_graph_matches ?? []) {
      if (!Number.isFinite(match.similarity) || match.similarity <= 0) continue;
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
        const accumulator = ensureAccumulator(
          match.id,
          match.label,
          match.taxonomyOnly,
          match.objectiveOnly,
          match.sourceNodeIds,
        );
        accumulator.embeddingValue = Math.max(
          accumulator.embeddingValue,
          Number((semanticValue * (match.weight / totalWeight)).toFixed(2)),
        );
      }
    }
  }

  const hasSpecificSemanticMatch = [...accumulators.values()]
    .some((entry) => !entry.taxonomyOnly && Math.max(entry.lexicalValue, entry.embeddingValue) > 0);
  const rankedSemantic = [...accumulators.values()]
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

  for (const entry of rankedSemantic) {
    if (entry.taxonomyOnly && hasSpecificSemanticMatch) continue;
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
  return extractLocalCandidateFeaturesWithCanonical(
    state,
    candidate,
    featureNodes,
    canonicalByNodeIdFromConcepts(canonical.concepts),
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
): ScoreFeatureSignal[] => {
  const features: ScoreFeatureSignal[] = [];
  const modeSimilarity = Number(candidate.semantic_mode_similarity ?? 0);

  const activeMode = mode.trim().toLowerCase();
  const hasActiveMode = Boolean(activeMode && activeMode !== 'default');

  if (hasActiveMode && Number.isFinite(modeSimilarity) && modeSimilarity >= 0.2) {
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
  const activeEntry = hasActiveMode
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

export function calibrateLocalScore(rawScore: number): number {
  if (!Number.isFinite(rawScore)) return 0;
  return Math.max(0, Math.min(100, Math.round(50 + 50 * Math.tanh(rawScore / 30))));
}

const candidateContext = (
  state: PersonalAlgorithmState,
  candidate: LocalRuntimeCandidate,
  index: LocalScoringIndex = buildLocalScoringIndex(state),
  mode = 'default',
): ScoreCandidate => {
  const contentId = contentNodeId('youtube', candidate.external_id);
  const contentNode = index.contentNodes.get(contentId);
  const extracted = extractLocalCandidateFeaturesWithCanonical(
    state,
    candidate,
    index.featureNodes,
    index.canonicalByNodeId,
  );
  const classification = classifyCandidateContent(candidate);
  // Once semantic mode similarity exists, it becomes the mode-ranking signal.
  // The deterministic classifier remains useful for UI labels/fallbacks, but
  // must not double-count the same active-mode intent.
  const modeFeature = candidate.semantic_mode_similarity == null
    ? modeAlignmentFeature(mode, classification)
    : null;
  if (modeFeature) extracted.features.push(modeFeature);
  extracted.features.push(...semanticAlignmentFeatures(candidate, mode));
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
  };
};

export function buildLocalScoringPolicy(state: PersonalAlgorithmState): PersonalScoringPolicy {
  const nodeWeights: Record<string, number> = {};
  for (const node of state.graph.nodes) {
    if (node.kind === 'content') nodeWeights[node.id] = 1;
    if (node.kind === 'creator') nodeWeights[node.id] = 8;
  }

  return {
    revision: 'local-mvp-p3',
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
      const contentNode = state?.graph.nodes.find((node) => node.id === contentNodeId('youtube', contentId ?? ''));
      const creatorEdge = contentNode
        ? state?.graph.edges.find((edge) => (
          edge.relation === 'created_by'
          && edge.sourceNodeId === contentNode.id
          && state.graph.nodes.some((node) => node.id === edge.targetNodeId && node.kind === 'creator')
        ))
        : undefined;
      const nodeId = event.eventType === 'never_show_channel'
        ? (
          event.channelId
            ? `creator:youtube:${encodeURIComponent(event.channelId)}`
            : creatorEdge?.targetNodeId ?? null
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

export function scoreLocalCandidates(
  state: PersonalAlgorithmState,
  candidates: LocalRuntimeCandidate[],
  mode: string,
  feedbackSignals: ScoreFeedbackSignal[] = [],
  sourceFilters: FeedSourceFilters = {},
): LocalRuntimeRankedCandidate[] {
  const policy = buildLocalScoringPolicy(state);
  const revisionContext = buildPersonalScoringRevisionContext(state, feedbackSignals);
  const scoringIndex = buildLocalScoringIndex(state);

  return candidates
    .map((candidate) => {
      const classification = classifyCandidateContent(candidate);
      const context = candidateContext(state, candidate, scoringIndex, mode);
      const result = scorePersonalAlgorithm(state, context, policy, mode, feedbackSignals, revisionContext);
      const visible = !(
        (candidate.is_short && sourceFilters.includeShorts === false)
        || (candidate.is_live && sourceFilters.includeLive === false)
        || (sourceFilters.subscribedOnly === true && candidate.source_kind !== 'subscription')
        || (sourceFilters.includeDiscovery === false && candidate.source_kind === 'discovery')
      );

      if (!isScoreTraceConsistent(result.trace)) {
        throw new Error(`Local score trace is inconsistent for ${candidate.external_id}`);
      }

      return {
        ...candidate,
        id: candidate.external_id,
        rawScore: result.score,
        score: calibrateLocalScore(result.score),
        visible,
        content_label: candidate.content_label ?? classification.label,
        content_label_confidence: candidate.content_label_confidence ?? classification.confidence,
        trace: result.trace,
      };
    })
    .sort((left, right) => right.score - left.score || right.rawScore - left.rawScore || left.external_id.localeCompare(right.external_id));
}

export function traceForLocalCandidate(
  state: PersonalAlgorithmState,
  candidate: LocalRuntimeCandidate,
  mode: string,
  feedbackSignals: ScoreFeedbackSignal[] = [],
): PersonalScoreTrace {
  const policy = buildLocalScoringPolicy(state);
  const result = scorePersonalAlgorithm(state, candidateContext(state, candidate, buildLocalScoringIndex(state), mode), policy, mode, feedbackSignals);
  if (!isScoreTraceConsistent(result.trace)) {
    throw new Error(`Local score trace is inconsistent for ${candidate.external_id}`);
  }
  return result.trace;
}
