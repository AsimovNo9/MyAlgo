import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  compareReplayStates,
  evaluateCanonicalAssignments,
  evaluateCanonicalSemanticAggregation,
  evaluateModeClusterAssignments,
  evaluateModeStability,
  evaluateModeSupply,
  evaluateModeTraceGrounding,
  evaluateReplacementStability,
  evaluateRetrievalModeChanges,
  evaluateSemanticPredictions,
  projectReplayState,
  reviewReplayState,
  runSemanticModeEvaluationFixture,
  selectQualifiedSemanticLabels,
  summarizeInferenceRuns,
} from '../src/replay-evaluation.ts';

const semanticFixture = JSON.parse(readFileSync(
  new URL('./fixtures/semantic-mode-eval-v1.json', import.meta.url),
  'utf8',
));
const graphFixture = JSON.parse(readFileSync(
  new URL('./fixtures/graph-replay-v2.json', import.meta.url),
  'utf8',
));

test('replay projection ignores collection order and volatile timestamps', () => {
  const original = structuredClone(graphFixture.state);
  const shuffled = structuredClone(graphFixture.state);
  shuffled.evidence.reverse();
  shuffled.graph.nodes.reverse();
  shuffled.graph.edges.reverse();
  shuffled.graph.userEdits.reverse();
  shuffled.graph.revisions.reverse();
  shuffled.evidence.forEach((record) => { record.retainedAt = '2030-01-01T00:00:00.000Z'; });
  shuffled.graph.nodes.forEach((node) => {
    node.createdAt = '2030-01-01T00:00:00.000Z';
    node.updatedAt = '2030-01-01T00:00:00.000Z';
  });
  shuffled.graph.edges.forEach((edge) => {
    edge.createdAt = '2030-01-01T00:00:00.000Z';
    edge.updatedAt = '2030-01-01T00:00:00.000Z';
  });

  assert.deepEqual(projectReplayState(shuffled), projectReplayState(original));
  assert.equal(compareReplayStates(original, shuffled).equal, true);
});

test('replay review detects stale support, duplicates and missing creator relationships', () => {
  const healthy = reviewReplayState(graphFixture.state);
  assert.equal(healthy.healthy, true);
  assert.equal(healthy.inferredEvidenceCoverage, 1);
  assert.deepEqual(healthy.missingCreatorRelationships, []);

  const broken = structuredClone(graphFixture.state);
  broken.graph.nodes.push(structuredClone(broken.graph.nodes[0]));
  broken.graph.edges.push({
    ...structuredClone(broken.graph.edges[0]),
    id: 'broken-duplicate-relationship',
    evidenceIds: ['missing-evidence'],
  });
  broken.graph.edges = broken.graph.edges.filter((edge) => edge.id !== 'edge:created_by:video-b');

  const review = reviewReplayState(broken);
  assert.equal(review.healthy, false);
  assert.ok(review.duplicateNodeIds.length > 0);
  assert.ok(review.duplicateRelationshipSignatures.length > 0);
  assert.ok(review.staleEvidenceReferences.includes('broken-duplicate-relationship:missing-evidence'));
  assert.ok(review.unsupportedInferredEdgeIds.includes('broken-duplicate-relationship'));
  assert.ok(review.missingCreatorRelationships.some((entry) => entry.startsWith('evidence-video-b:')));
});

test('semantic evaluation metrics are multi-label and badge abstention aware', () => {
  const metrics = evaluateSemanticPredictions([
    {
      id: 'a',
      expectedLabels: ['AI', 'Distributed'],
      predictedLabels: ['AI', 'Distributed'],
      predictedPrimaryLabel: 'AI',
    },
    {
      id: 'b',
      expectedLabels: ['Finance'],
      predictedLabels: ['Finance', 'AI'],
      predictedPrimaryLabel: 'Finance',
    },
    {
      id: 'c',
      expectedLabels: [],
      ambiguous: true,
      predictedLabels: [],
      predictedPrimaryLabel: null,
    },
  ]);

  assert.equal(metrics.exampleCount, 3);
  assert.equal(metrics.micro.truePositive, 3);
  assert.equal(metrics.micro.falsePositive, 1);
  assert.equal(metrics.micro.falseNegative, 0);
  assert.equal(metrics.primaryBadgePrecision, 1);
  assert.equal(metrics.ambiguousFalseConfidentRate, 0);
});

test('qualified semantic labels retain secondary matches without forcing a primary label', () => {
  assert.deepEqual(
    selectQualifiedSemanticLabels({
      'Local AI tooling': 0.61,
      'Distributed systems': 0.48,
      'Ambient music': 0.08,
    }),
    ['Local AI tooling', 'Distributed systems'],
  );
});

test('fixed semantic fixture is deterministic and establishes a CI quality baseline', async () => {
  assert.equal(semanticFixture.examples.length, 64);

  const first = await runSemanticModeEvaluationFixture(semanticFixture);
  const second = await runSemanticModeEvaluationFixture(semanticFixture);

  assert.deepEqual(second, first);
  assert.equal(first.metrics.exampleCount, 64);
  assert.ok(first.metrics.labelCount >= 8);
  assert.ok(first.metrics.micro.f1 >= 0.55, `micro F1 ${first.metrics.micro.f1}`);
  assert.ok(first.metrics.primaryBadgePrecision >= 0.8, `badge precision ${first.metrics.primaryBadgePrecision}`);
  assert.ok(first.metrics.ambiguousFalseConfidentRate <= 0.25, `ambiguous false confident ${first.metrics.ambiguousFalseConfidentRate}`);
});

test('canonical assignment evaluation reports exact alias mismatches', () => {
  const result = evaluateCanonicalAssignments([
    { alias: 'Elden Ring', expectedCanonicalId: 'game:elden-ring' },
    { alias: 'elden ring pvp', expectedCanonicalId: 'game:elden-ring' },
  ], {
    'Elden Ring': 'game:elden-ring',
    'elden ring pvp': 'game:pvp',
  });
  assert.equal(result.total, 2);
  assert.equal(result.correct, 1);
  assert.equal(result.accuracy, 0.5);
  assert.deepEqual(result.mismatches.map((item) => item.alias), ['elden ring pvp']);
});

test('canonical aggregation metrics expose duplicate score mass and display saturation reduction', () => {
  const metrics = evaluateCanonicalSemanticAggregation([
    {
      id: 'grok',
      sourceNodeMatchCount: 4,
      canonicalNeighbourhoodMatchCount: 1,
      lexicalContributionMass: 45.92,
      embeddingContributionMass: 16.2,
      reconciledContributionMass: 16.2,
      rawScoreBefore: 62.12,
      rawScoreAfter: 16.2,
      displayScoreBefore: 98,
      displayScoreAfter: 75,
    },
    {
      id: 'specific-plus-taxonomy',
      sourceNodeMatchCount: 2,
      canonicalNeighbourhoodMatchCount: 1,
      lexicalContributionMass: 18.68,
      embeddingContributionMass: 0,
      reconciledContributionMass: 11.48,
      rawScoreBefore: 18.68,
      rawScoreAfter: 11.48,
      displayScoreBefore: 78,
      displayScoreAfter: 68,
    },
  ]);

  assert.equal(metrics.sampleCount, 2);
  assert.equal(metrics.sourceNodeMatchCount, 6);
  assert.equal(metrics.canonicalNeighbourhoodMatchCount, 2);
  assert.equal(metrics.matchCompressionRatio, 1 / 3);
  assert.equal(metrics.lexicalEmbeddingOverlapCount, 1);
  assert.ok(metrics.semanticContributionMassReduction > 0);
  assert.equal(metrics.displaySaturationBeforeRate, 0.5);
  assert.equal(metrics.displaySaturationAfterRate, 0);
});

test('mode supply metrics tie banner firing to requested slot shortfall', () => {
  const metrics = evaluateModeSupply([
    { requestedSlots: 2, nativeMatchingSupply: 3, acquiredMatchingSupply: 5, fulfilledSlots: 2, bannerFired: false },
    { requestedSlots: 8, nativeMatchingSupply: 3, acquiredMatchingSupply: 5, fulfilledSlots: 8, bannerFired: true },
    { requestedSlots: 6, nativeMatchingSupply: 4, acquiredMatchingSupply: 1, fulfilledSlots: 5, bannerFired: true },
  ]);
  assert.equal(metrics.expectedShortfallCount, 2);
  assert.equal(metrics.bannerPrecision, 1);
  assert.equal(metrics.bannerRecall, 1);
  assert.equal(metrics.requestedShortfallSlots, 7);
  assert.equal(metrics.fulfilledFromAcquired, 6);
  assert.equal(metrics.acquiredFillRate, 6 / 7);
});

test('replacement stability only penalizes changed common sources', () => {
  const metrics = evaluateReplacementStability(
    { a: 'one', b: 'two', c: 'three' },
    { a: 'one', b: 'changed', d: 'four' },
  );
  assert.equal(metrics.commonSourceCount, 2);
  assert.equal(metrics.changedSourceCount, 1);
  assert.equal(metrics.stabilityRate, 0.5);
  assert.deepEqual(metrics.changed, [{
    sourceId: 'b',
    beforeCandidateId: 'two',
    afterCandidateId: 'changed',
  }]);
});

test('inference summary compares throughput and fallback by batch size', () => {
  const summary = summarizeInferenceRuns([
    { inputCount: 8, elapsedMs: 800, backend: 'webgpu-sandbox', batchSize: 1 },
    { inputCount: 16, elapsedMs: 800, backend: 'webgpu-sandbox', batchSize: 4 },
    { inputCount: 8, elapsedMs: 1600, backend: 'wasm-sandbox', batchSize: 4, fallback: true },
  ]);
  assert.equal(summary.runCount, 3);
  assert.equal(summary.totalInputs, 32);
  assert.equal(summary.fallbackRate, 1 / 3);
  assert.equal(summary.byBatchSize['1'].inputsPerSecond, 10);
  assert.equal(summary.byBatchSize['4'].inputs, 24);
});


test('mode cluster metrics expose purity and fragmentation independently', () => {
  const metrics = evaluateModeClusterAssignments([
    { conceptId: 'elden-ring', expectedModeId: 'gaming', predictedModeId: 'gaming' },
    { conceptId: 'elden-ring-pvp', expectedModeId: 'gaming', predictedModeId: 'gaming' },
    { conceptId: 'elden-ring-builds', expectedModeId: 'gaming', predictedModeId: 'gaming-builds' },
    { conceptId: 'crdts', expectedModeId: 'systems', predictedModeId: 'systems' },
    { conceptId: 'replication', expectedModeId: 'systems', predictedModeId: null },
  ]);
  assert.equal(metrics.assignmentCount, 5);
  assert.equal(metrics.assignedCount, 4);
  assert.equal(metrics.assignmentAccuracy, 3 / 5);
  assert.equal(metrics.averageClusterPurity, 1);
  assert.equal(metrics.averageExpectedModeFragmentation, 1.5);
  assert.deepEqual(metrics.unassignedConceptIds, ['replication']);
});

test('durable mode stability measures identity and membership churn', () => {
  const metrics = evaluateModeStability(
    {
      gaming: { label: 'Gaming', memberNodeIds: ['a', 'b', 'c'], revision: 1 },
      systems: { label: 'Systems', memberNodeIds: ['d', 'e'], revision: 1 },
    },
    {
      gaming: { label: 'Gaming', memberNodeIds: ['a', 'b', 'c'], revision: 2 },
      systems: { label: 'Distributed systems', memberNodeIds: ['d', 'e', 'f'], revision: 2 },
      finance: { label: 'Finance', memberNodeIds: ['g'], revision: 1 },
    },
  );
  assert.equal(metrics.commonModeCount, 2);
  assert.deepEqual(metrics.addedModeIds, ['finance']);
  assert.deepEqual(metrics.removedModeIds, []);
  assert.deepEqual(metrics.changedLabelIds, ['systems']);
  assert.equal(metrics.averageMemberJaccard, (1 + (2 / 3)) / 2);
});

test('mode trace grounding requires graph members and exact reconciliation', () => {
  const metrics = evaluateModeTraceGrounding([
    {
      traceId: 'good',
      modeContribution: 3,
      modeId: 'mode:systems',
      modeRevision: 2,
      contributingNodeIds: ['topic:crdts', 'topic:replication'],
      memberContributions: [1.25, 1.75],
    },
    {
      traceId: 'bad',
      modeContribution: 2,
      modeId: null,
      modeRevision: null,
      contributingNodeIds: [],
      memberContributions: [1],
    },
  ]);
  assert.equal(metrics.groundingRate, 0.5);
  assert.equal(metrics.reconciliationRate, 0.5);
  assert.equal(metrics.errors.length, 2);
});

test('retrieval mode evaluation detects whether query plans actually change', () => {
  const metrics = evaluateRetrievalModeChanges([
    {
      id: 'all',
      baselineQueries: ['distributed systems tutorial'],
      modeQueries: ['distributed systems tutorial'],
      expectedChange: false,
    },
    {
      id: 'work',
      baselineQueries: ['distributed systems tutorial'],
      modeQueries: ['distributed systems tutorial', 'crdt implementation'],
      expectedChange: true,
    },
  ]);
  assert.equal(metrics.accuracy, 1);
  assert.equal(metrics.observedChangeCount, 1);
  assert.deepEqual(metrics.mismatches, []);
});
