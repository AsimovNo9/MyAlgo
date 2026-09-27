import type {
  PersonalAlgorithmState,
  RecommendationCandidate,
  SemanticCategoryId,
} from '@repo/shared-types';

import {
  createLocalHashEmbeddingProvider,
  enrichCandidatesWithSemanticReranking,
  type EmbeddingCache,
  type LocalEmbeddingProvider,
} from './semantic-reranking.ts';

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

const stableJsonValue = (value: unknown): JsonValue => {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') {
    return value as null | string | boolean;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableJsonValue(nested)]),
    );
  }
  return String(value);
};

const stableStringify = (value: unknown): string => JSON.stringify(stableJsonValue(value));

const normalizeLabel = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const contentNodeId = (source: string, externalId: string): string =>
  `content:${encodeURIComponent(source)}:${encodeURIComponent(externalId)}`;

const creatorNodeId = (source: string, creatorKey: string): string =>
  `creator:${encodeURIComponent(source)}:${encodeURIComponent(creatorKey)}`;

export type ReplayStateProjection = {
  schemaVersion: number;
  evidence: Array<{
    id: string;
    confidence: number;
    retention: JsonValue;
    evidence: JsonValue;
  }>;
  graph: {
    currentRevision: number;
    nodes: Array<{
      id: string;
      kind: string;
      label: string;
      content: JsonValue;
      provenance: string;
      confidence: number | null;
      attributes: JsonValue;
    }>;
    edges: Array<{
      id: string;
      sourceNodeId: string;
      targetNodeId: string;
      relation: string;
      provenance: string;
      confidence: number | null;
      evidenceIds: string[];
      attributes: JsonValue;
    }>;
    userEdits: Array<{
      action: string;
      targetId: string;
      before: JsonValue;
      after: JsonValue;
    }>;
    revisions: Array<{
      revision: number;
      reason: string;
    }>;
  };
};

export function projectReplayState(state: PersonalAlgorithmState): ReplayStateProjection {
  return {
    schemaVersion: state.schemaVersion,
    evidence: state.evidence
      .map((record) => ({
        id: record.id,
        confidence: record.confidence,
        retention: stableJsonValue(record.retention),
        evidence: stableJsonValue(record.evidence),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    graph: {
      currentRevision: state.graph.currentRevision,
      nodes: state.graph.nodes
        .map((node) => ({
          id: node.id,
          kind: node.kind,
          label: node.label,
          content: stableJsonValue(node.content ?? null),
          provenance: node.provenance,
          confidence: node.confidence,
          attributes: stableJsonValue(node.attributes),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      edges: state.graph.edges
        .map((edge) => ({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          relation: edge.relation,
          provenance: edge.provenance,
          confidence: edge.confidence,
          evidenceIds: [...new Set(edge.evidenceIds)].sort(),
          attributes: stableJsonValue(edge.attributes),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      userEdits: state.graph.userEdits
        .map((edit) => ({
          action: edit.action,
          targetId: edit.targetId,
          before: stableJsonValue(edit.before),
          after: stableJsonValue(edit.after),
        }))
        .sort((left, right) => (
          left.targetId.localeCompare(right.targetId)
          || left.action.localeCompare(right.action)
          || stableStringify(left.before).localeCompare(stableStringify(right.before))
        )),
      revisions: state.graph.revisions
        .map((revision) => ({
          revision: revision.revision,
          reason: revision.reason,
        }))
        .sort((left, right) => left.revision - right.revision || left.reason.localeCompare(right.reason)),
    },
  };
}

type ReplayCollectionDifference = {
  missingFromRight: string[];
  missingFromLeft: string[];
  changed: string[];
};

const compareById = <T extends { id: string }>(
  left: readonly T[],
  right: readonly T[],
): ReplayCollectionDifference => {
  const leftById = new Map(left.map((item) => [item.id, item]));
  const rightById = new Map(right.map((item) => [item.id, item]));
  const missingFromRight = [...leftById.keys()].filter((id) => !rightById.has(id)).sort();
  const missingFromLeft = [...rightById.keys()].filter((id) => !leftById.has(id)).sort();
  const changed = [...leftById.keys()]
    .filter((id) => rightById.has(id) && stableStringify(leftById.get(id)) !== stableStringify(rightById.get(id)))
    .sort();
  return { missingFromRight, missingFromLeft, changed };
};

export type ReplayStateComparison = {
  equal: boolean;
  schemaVersionChanged: boolean;
  revisionChanged: boolean;
  evidence: ReplayCollectionDifference;
  nodes: ReplayCollectionDifference;
  edges: ReplayCollectionDifference;
  userEditsChanged: boolean;
  revisionsChanged: boolean;
};

export function compareReplayStates(
  leftState: PersonalAlgorithmState,
  rightState: PersonalAlgorithmState,
): ReplayStateComparison {
  const left = projectReplayState(leftState);
  const right = projectReplayState(rightState);
  const comparison: ReplayStateComparison = {
    equal: false,
    schemaVersionChanged: left.schemaVersion !== right.schemaVersion,
    revisionChanged: left.graph.currentRevision !== right.graph.currentRevision,
    evidence: compareById(left.evidence, right.evidence),
    nodes: compareById(left.graph.nodes, right.graph.nodes),
    edges: compareById(left.graph.edges, right.graph.edges),
    userEditsChanged: stableStringify(left.graph.userEdits) !== stableStringify(right.graph.userEdits),
    revisionsChanged: stableStringify(left.graph.revisions) !== stableStringify(right.graph.revisions),
  };
  comparison.equal = !comparison.schemaVersionChanged
    && !comparison.revisionChanged
    && comparison.evidence.missingFromRight.length === 0
    && comparison.evidence.missingFromLeft.length === 0
    && comparison.evidence.changed.length === 0
    && comparison.nodes.missingFromRight.length === 0
    && comparison.nodes.missingFromLeft.length === 0
    && comparison.nodes.changed.length === 0
    && comparison.edges.missingFromRight.length === 0
    && comparison.edges.missingFromLeft.length === 0
    && comparison.edges.changed.length === 0
    && !comparison.userEditsChanged
    && !comparison.revisionsChanged;
  return comparison;
}

const duplicateValues = (values: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort();
};

export type ReplayStateReview = {
  healthy: boolean;
  duplicateNodeIds: string[];
  duplicateEdgeIds: string[];
  duplicateRelationshipSignatures: string[];
  missingNodeReferences: string[];
  staleEvidenceReferences: string[];
  unsupportedInferredEdgeIds: string[];
  missingCreatorRelationships: string[];
  inferredEdgeCount: number;
  supportedInferredEdgeCount: number;
  inferredEvidenceCoverage: number;
};

export function reviewReplayState(state: PersonalAlgorithmState): ReplayStateReview {
  const evidenceIds = new Set(state.evidence.map((record) => record.id));
  const nodeIds = new Set(state.graph.nodes.map((node) => node.id));
  const duplicateNodeIds = duplicateValues(state.graph.nodes.map((node) => node.id));
  const duplicateEdgeIds = duplicateValues(state.graph.edges.map((edge) => edge.id));
  const duplicateRelationshipSignatures = duplicateValues(state.graph.edges.map((edge) => (
    `${edge.sourceNodeId}|${edge.relation}|${edge.targetNodeId}`
  )));

  const staleEvidenceReferences = [...new Set(state.graph.edges.flatMap((edge) =>
    edge.evidenceIds
      .filter((evidenceId) => !evidenceIds.has(evidenceId))
      .map((evidenceId) => `${edge.id}:${evidenceId}`),
  ))].sort();

  const missingNodeReferences = [...new Set(state.graph.edges.flatMap((edge) => {
    const missing: string[] = [];
    if (!nodeIds.has(edge.sourceNodeId)) missing.push(`${edge.id}:source:${edge.sourceNodeId}`);
    if (!nodeIds.has(edge.targetNodeId)) missing.push(`${edge.id}:target:${edge.targetNodeId}`);
    return missing;
  }))].sort();

  const inferredEdges = state.graph.edges.filter((edge) => edge.provenance === 'inferred');
  const supportedInferredEdges = inferredEdges.filter((edge) => (
    edge.evidenceIds.some((evidenceId) => evidenceIds.has(evidenceId))
  ));
  const unsupportedInferredEdgeIds = inferredEdges
    .filter((edge) => !edge.evidenceIds.some((evidenceId) => evidenceIds.has(evidenceId)))
    .map((edge) => edge.id)
    .sort();

  const edgeByRelationship = new Map(
    state.graph.edges.map((edge) => [
      `${edge.sourceNodeId}|created_by|${edge.targetNodeId}`,
      edge,
    ]),
  );
  const missingCreatorRelationships: string[] = [];
  for (const record of state.evidence) {
    const metadata = record.evidence.metadata;
    const creatorKey = metadata?.creatorId ?? metadata?.creatorName;
    if (!creatorKey) continue;
    const sourceId = contentNodeId(record.evidence.content.source, record.evidence.content.externalId);
    const targetId = creatorNodeId(record.evidence.content.source, creatorKey);
    const edge = edgeByRelationship.get(`${sourceId}|created_by|${targetId}`);
    if (!edge || !edge.evidenceIds.includes(record.id)) {
      missingCreatorRelationships.push(`${record.id}:${sourceId}->${targetId}`);
    }
  }
  missingCreatorRelationships.sort();

  const review: ReplayStateReview = {
    healthy: false,
    duplicateNodeIds,
    duplicateEdgeIds,
    duplicateRelationshipSignatures,
    missingNodeReferences,
    staleEvidenceReferences,
    unsupportedInferredEdgeIds,
    missingCreatorRelationships,
    inferredEdgeCount: inferredEdges.length,
    supportedInferredEdgeCount: supportedInferredEdges.length,
    inferredEvidenceCoverage: inferredEdges.length > 0
      ? supportedInferredEdges.length / inferredEdges.length
      : 1,
  };
  review.healthy = duplicateNodeIds.length === 0
    && duplicateEdgeIds.length === 0
    && duplicateRelationshipSignatures.length === 0
    && missingNodeReferences.length === 0
    && staleEvidenceReferences.length === 0
    && unsupportedInferredEdgeIds.length === 0
    && missingCreatorRelationships.length === 0;
  return review;
}

export type SemanticEvaluationExample = {
  id: string;
  expectedLabels: string[];
  ambiguous?: boolean;
  predictedLabels: string[];
  predictedPrimaryLabel: string | null;
};

export type LabelMetrics = {
  precision: number;
  recall: number;
  f1: number;
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
};

export type SemanticEvaluationMetrics = {
  exampleCount: number;
  labelCount: number;
  micro: LabelMetrics;
  macro: Pick<LabelMetrics, 'precision' | 'recall' | 'f1'>;
  exactSetMatchRate: number;
  primaryBadgePrecision: number;
  primaryBadgeCoverage: number;
  primaryBadgeAbstentionRate: number;
  ambiguousExampleCount: number;
  ambiguousFalseConfidentRate: number;
  perLabel: Record<string, LabelMetrics>;
};

const safeDivide = (numerator: number, denominator: number): number =>
  denominator > 0 ? numerator / denominator : 0;

const metricsFromCounts = (tp: number, fp: number, fn: number): LabelMetrics => {
  const precision = safeDivide(tp, tp + fp);
  const recall = safeDivide(tp, tp + fn);
  return {
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
  };
};

export function selectQualifiedSemanticLabels(
  scores: Partial<Record<SemanticCategoryId, number>>,
  options: { minimumScore?: number; maxLabels?: number } = {},
): string[] {
  const minimumScore = Math.max(0, Math.min(1, options.minimumScore ?? 0.22));
  const maxLabels = Math.max(1, Math.floor(options.maxLabels ?? 4));
  return Object.entries(scores)
    .map(([label, rawScore]) => ({ label: label.trim(), score: Number(rawScore ?? 0) }))
    .filter((entry) => entry.label && Number.isFinite(entry.score) && entry.score >= minimumScore)
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, maxLabels)
    .map((entry) => entry.label);
}

export function evaluateSemanticPredictions(
  examples: readonly SemanticEvaluationExample[],
): SemanticEvaluationMetrics {
  const allLabels = new Set<string>();
  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;
  let exactMatches = 0;
  let primaryPredicted = 0;
  let primaryCorrect = 0;
  let ambiguousExampleCount = 0;
  let ambiguousFalseConfident = 0;

  const normalizedRows = examples.map((example) => {
    const expected = new Set(example.expectedLabels.map(normalizeLabel).filter(Boolean));
    const predicted = new Set(example.predictedLabels.map(normalizeLabel).filter(Boolean));
    expected.forEach((label) => allLabels.add(label));
    predicted.forEach((label) => allLabels.add(label));

    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const label of predicted) {
      if (expected.has(label)) tp += 1;
      else fp += 1;
    }
    for (const label of expected) {
      if (!predicted.has(label)) fn += 1;
    }
    totalTp += tp;
    totalFp += fp;
    totalFn += fn;
    if (tp === expected.size && fp === 0 && fn === 0) exactMatches += 1;

    const primary = example.predictedPrimaryLabel
      ? normalizeLabel(example.predictedPrimaryLabel)
      : null;
    if (primary) {
      primaryPredicted += 1;
      if (expected.has(primary)) primaryCorrect += 1;
    }
    if (example.ambiguous) {
      ambiguousExampleCount += 1;
      if (primary) ambiguousFalseConfident += 1;
    }

    return { expected, predicted };
  });

  const perLabel: Record<string, LabelMetrics> = {};
  for (const label of [...allLabels].sort()) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const row of normalizedRows) {
      const expected = row.expected.has(label);
      const predicted = row.predicted.has(label);
      if (expected && predicted) tp += 1;
      else if (!expected && predicted) fp += 1;
      else if (expected && !predicted) fn += 1;
    }
    perLabel[label] = metricsFromCounts(tp, fp, fn);
  }

  const labelMetrics = Object.values(perLabel);
  const macro = {
    precision: safeDivide(labelMetrics.reduce((sum, metric) => sum + metric.precision, 0), labelMetrics.length),
    recall: safeDivide(labelMetrics.reduce((sum, metric) => sum + metric.recall, 0), labelMetrics.length),
    f1: safeDivide(labelMetrics.reduce((sum, metric) => sum + metric.f1, 0), labelMetrics.length),
  };

  return {
    exampleCount: examples.length,
    labelCount: allLabels.size,
    micro: metricsFromCounts(totalTp, totalFp, totalFn),
    macro,
    exactSetMatchRate: safeDivide(exactMatches, examples.length),
    primaryBadgePrecision: safeDivide(primaryCorrect, primaryPredicted),
    primaryBadgeCoverage: safeDivide(primaryPredicted, examples.length),
    primaryBadgeAbstentionRate: 1 - safeDivide(primaryPredicted, examples.length),
    ambiguousExampleCount,
    ambiguousFalseConfidentRate: safeDivide(ambiguousFalseConfident, ambiguousExampleCount),
    perLabel,
  };
}

export type SemanticModeEvaluationFixture = {
  fixtureVersion: number;
  name: string;
  description?: string;
  state: PersonalAlgorithmState;
  examples: Array<{
    id: string;
    candidate: RecommendationCandidate;
    expectedLabels: string[];
    ambiguous?: boolean;
    sourceClass?: 'native' | 'acquired';
    expectedEligible?: boolean;
  }>;
  thresholds?: {
    multiLabelMinimumScore?: number;
    maxPredictedLabels?: number;
  };
};

export type SemanticModeEvaluationReport = {
  fixtureVersion: number;
  fixtureName: string;
  provider: {
    modelId: string;
    modelVersion: string;
    dimensions: number;
  };
  metrics: SemanticEvaluationMetrics;
  predictions: Array<{
    id: string;
    expectedLabels: string[];
    ambiguous: boolean;
    predictedLabels: string[];
    predictedPrimaryLabel: string | null;
    categoryScores: Record<string, number>;
  }>;
};

const createMemoryEmbeddingCache = (): EmbeddingCache => {
  const entries = new Map<string, Awaited<ReturnType<EmbeddingCache['get']>>>();
  return {
    async get(key) {
      return entries.get(key) ?? null;
    },
    async set(key, record) {
      entries.set(key, record);
    },
  };
};

export async function runSemanticModeEvaluationFixture(
  fixture: SemanticModeEvaluationFixture,
  provider: LocalEmbeddingProvider = createLocalHashEmbeddingProvider(192),
): Promise<SemanticModeEvaluationReport> {
  const candidates = fixture.examples.map((example) => example.candidate);
  const result = await enrichCandidatesWithSemanticReranking(
    fixture.state,
    candidates,
    'Default',
    provider,
    createMemoryEmbeddingCache(),
    {
      maxGraphNodes: 64,
      minimumModeNodeSimilarity: 0.15,
    },
  );

  const predictions = fixture.examples.map((example, index) => {
    const candidate = result.candidates[index];
    const categoryScores = Object.fromEntries(
      Object.entries(candidate?.semantic_category_scores ?? {})
        .map(([label, score]) => ({ label, score: Number(score ?? 0) }))
        .sort((left, right) => left.label.localeCompare(right.label))
        .map(({ label, score }) => [label, score]),
    );
    return {
      id: example.id,
      expectedLabels: [...example.expectedLabels],
      ambiguous: example.ambiguous === true,
      predictedLabels: selectQualifiedSemanticLabels(categoryScores, {
        minimumScore: fixture.thresholds?.multiLabelMinimumScore ?? 0.22,
        maxLabels: fixture.thresholds?.maxPredictedLabels ?? 4,
      }),
      predictedPrimaryLabel: candidate?.semantic_category ?? null,
      categoryScores,
    };
  });

  return {
    fixtureVersion: fixture.fixtureVersion,
    fixtureName: fixture.name,
    provider: {
      modelId: provider.modelId,
      modelVersion: provider.modelVersion,
      dimensions: provider.dimensions,
    },
    metrics: evaluateSemanticPredictions(predictions),
    predictions,
  };
}

export type CanonicalAssignmentExpectation = {
  alias: string;
  expectedCanonicalId: string;
};

export type CanonicalAssignmentMetrics = {
  total: number;
  correct: number;
  accuracy: number;
  mismatches: Array<{
    alias: string;
    expectedCanonicalId: string;
    predictedCanonicalId: string | null;
  }>;
};

export function evaluateCanonicalAssignments(
  expectations: readonly CanonicalAssignmentExpectation[],
  predictedAssignments: Readonly<Record<string, string | null | undefined>>,
): CanonicalAssignmentMetrics {
  const mismatches = expectations
    .map((expectation) => ({
      alias: expectation.alias,
      expectedCanonicalId: expectation.expectedCanonicalId,
      predictedCanonicalId: predictedAssignments[expectation.alias] ?? null,
    }))
    .filter((entry) => entry.predictedCanonicalId !== entry.expectedCanonicalId);
  return {
    total: expectations.length,
    correct: expectations.length - mismatches.length,
    accuracy: safeDivide(expectations.length - mismatches.length, expectations.length),
    mismatches,
  };
}

export type ModeSupplySample = {
  requestedSlots: number;
  nativeMatchingSupply: number;
  acquiredMatchingSupply: number;
  fulfilledSlots: number;
  bannerFired: boolean;
};

export type ModeSupplyMetrics = {
  sampleCount: number;
  expectedShortfallCount: number;
  bannerPrecision: number;
  bannerRecall: number;
  bannerAccuracy: number;
  requestedShortfallSlots: number;
  fulfilledFromAcquired: number;
  acquiredFillRate: number;
};

export function evaluateModeSupply(
  samples: readonly ModeSupplySample[],
): ModeSupplyMetrics {
  let bannerTp = 0;
  let bannerFp = 0;
  let bannerFn = 0;
  let bannerCorrect = 0;
  let expectedShortfallCount = 0;
  let requestedShortfallSlots = 0;
  let fulfilledFromAcquired = 0;

  for (const sample of samples) {
    const requested = Math.max(0, Math.floor(sample.requestedSlots));
    const native = Math.max(0, Math.floor(sample.nativeMatchingSupply));
    const fulfilled = Math.max(0, Math.floor(sample.fulfilledSlots));
    const shortfall = Math.max(0, requested - native);
    const expectedShortfall = shortfall > 0;
    if (expectedShortfall) {
      expectedShortfallCount += 1;
      requestedShortfallSlots += shortfall;
    }
    if (sample.bannerFired && expectedShortfall) bannerTp += 1;
    else if (sample.bannerFired) bannerFp += 1;
    else if (expectedShortfall) bannerFn += 1;
    if (sample.bannerFired === expectedShortfall) bannerCorrect += 1;

    const availableAcquired = Math.max(0, Math.floor(sample.acquiredMatchingSupply));
    const extraFulfilled = Math.max(0, fulfilled - Math.min(native, requested));
    fulfilledFromAcquired += Math.min(shortfall, availableAcquired, extraFulfilled);
  }

  return {
    sampleCount: samples.length,
    expectedShortfallCount,
    bannerPrecision: safeDivide(bannerTp, bannerTp + bannerFp),
    bannerRecall: safeDivide(bannerTp, bannerTp + bannerFn),
    bannerAccuracy: safeDivide(bannerCorrect, samples.length),
    requestedShortfallSlots,
    fulfilledFromAcquired,
    acquiredFillRate: safeDivide(fulfilledFromAcquired, requestedShortfallSlots),
  };
}

export type ReplacementSnapshot = Record<string, string>;

export type ReplacementStabilityMetrics = {
  beforeCount: number;
  afterCount: number;
  commonSourceCount: number;
  changedSourceCount: number;
  stabilityRate: number;
  changed: Array<{ sourceId: string; beforeCandidateId: string; afterCandidateId: string }>;
};

export function evaluateReplacementStability(
  before: ReplacementSnapshot,
  after: ReplacementSnapshot,
): ReplacementStabilityMetrics {
  const commonSources = Object.keys(before).filter((sourceId) => after[sourceId] != null).sort();
  const changed = commonSources
    .filter((sourceId) => before[sourceId] !== after[sourceId])
    .map((sourceId) => ({
      sourceId,
      beforeCandidateId: before[sourceId],
      afterCandidateId: after[sourceId],
    }));

  return {
    beforeCount: Object.keys(before).length,
    afterCount: Object.keys(after).length,
    commonSourceCount: commonSources.length,
    changedSourceCount: changed.length,
    stabilityRate: commonSources.length > 0
      ? (commonSources.length - changed.length) / commonSources.length
      : 1,
    changed,
  };
}

export type InferenceRunSample = {
  inputCount: number;
  elapsedMs: number;
  backend: string;
  batchSize: number;
  fallback?: boolean;
};

export type InferencePerformanceSummary = {
  runCount: number;
  totalInputs: number;
  totalElapsedMs: number;
  inputsPerSecond: number;
  fallbackRate: number;
  byBatchSize: Record<string, {
    runs: number;
    inputs: number;
    elapsedMs: number;
    inputsPerSecond: number;
  }>;
};

export function summarizeInferenceRuns(
  runs: readonly InferenceRunSample[],
): InferencePerformanceSummary {
  let totalInputs = 0;
  let totalElapsedMs = 0;
  let fallbacks = 0;
  const byBatch = new Map<number, { runs: number; inputs: number; elapsedMs: number }>();

  for (const run of runs) {
    const inputCount = Math.max(0, Math.floor(run.inputCount));
    const elapsedMs = Math.max(0, Number(run.elapsedMs) || 0);
    const batchSize = Math.max(1, Math.floor(run.batchSize));
    totalInputs += inputCount;
    totalElapsedMs += elapsedMs;
    if (run.fallback) fallbacks += 1;
    const current = byBatch.get(batchSize) ?? { runs: 0, inputs: 0, elapsedMs: 0 };
    current.runs += 1;
    current.inputs += inputCount;
    current.elapsedMs += elapsedMs;
    byBatch.set(batchSize, current);
  }

  return {
    runCount: runs.length,
    totalInputs,
    totalElapsedMs,
    inputsPerSecond: totalElapsedMs > 0 ? totalInputs / (totalElapsedMs / 1000) : 0,
    fallbackRate: safeDivide(fallbacks, runs.length),
    byBatchSize: Object.fromEntries([...byBatch.entries()]
      .sort(([left], [right]) => left - right)
      .map(([batchSize, summary]) => [
        String(batchSize),
        {
          ...summary,
          inputsPerSecond: summary.elapsedMs > 0
            ? summary.inputs / (summary.elapsedMs / 1000)
            : 0,
        },
      ])),
  };
}
