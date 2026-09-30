import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateModeTraceGrounding } from '@repo/recommender-core';
import {
  buildLocalFeedbackSignals,
  buildLocalScoringPolicy,
  calibrateLocalScore,
  classifyCandidateContent,
  extractLocalCandidateFeatures,
  getLocalScoringDiagnostics,
  scoreLocalCandidates,
  summarizeLocalScoreCalibration,
} from './personal-algorithm-runtime.ts';

const state = {
  schemaVersion: 2,
  evidence: [],
  graph: {
    nodes: [
      {
        id: 'content:youtube:video-a',
        kind: 'content',
        label: 'Video A',
        content: { source: 'youtube', externalId: 'video-a' },
        provenance: 'inferred',
        confidence: 1,
        attributes: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'creator:youtube:Creator%20A',
        kind: 'creator',
        label: 'Creator A',
        provenance: 'inferred',
        confidence: 1,
        attributes: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'content:youtube:video-b',
        kind: 'content',
        label: 'Video B',
        content: { source: 'youtube', externalId: 'video-b' },
        provenance: 'inferred',
        confidence: 1,
        attributes: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'content:youtube:video-c',
        kind: 'content',
        label: 'Video C',
        content: { source: 'youtube', externalId: 'video-c' },
        provenance: 'inferred',
        confidence: 1,
        attributes: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    edges: [
      {
        id: 'edge:created_by:video-a',
        sourceNodeId: 'content:youtube:video-a',
        targetNodeId: 'creator:youtube:Creator%20A',
        relation: 'created_by',
        provenance: 'inferred',
        confidence: 1,
        evidenceIds: ['e1'],
        attributes: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'edge:created_by:video-c',
        sourceNodeId: 'content:youtube:video-c',
        targetNodeId: 'creator:youtube:Creator%20A',
        relation: 'created_by',
        provenance: 'inferred',
        confidence: 1,
        evidenceIds: ['e1'],
        attributes: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    userEdits: [],
    revisions: [],
    currentRevision: 4,
  },
};

test('local runtime scores candidates from the persisted graph and returns deterministic traces', () => {
  const ranked = scoreLocalCandidates(state, [
    { external_id: 'video-b', title: 'Video B' },
    {
      external_id: 'video-a',
      title: 'Video A',
      semantic_mode_affinities: [{
        modeId: 'mode:inferred:v1:test',
        modeRevision: 2,
        label: 'Test durable mode',
        affinity: 0.72,
        matchedCanonicalIds: ['canonical:test'],
        sourceNodeIds: ['topic:test'],
      }],
    },
  ], 'Work');

  assert.equal(ranked[0].external_id, 'video-a');
  assert.equal(ranked[0].rawScore, 11);
  assert.equal(ranked[0].score, calibrateLocalScore(11));
  assert.equal(ranked[0].trace.policyRevision, 'local-mvp-p7');
  assert.equal(ranked[0].trace.graphRevision, 4);
  assert.equal(ranked[0].trace.finalScore, 11);
  assert.equal(ranked[0].trace.edgeContributions.length, 1);
  assert.equal(ranked[0].trace.nodeContributions.length, 2);
  assert.equal(ranked[0].trace.suppressed, false);
  assert.deepEqual(ranked[0].semantic_mode_affinities, [{
    modeId: 'mode:inferred:v1:test',
    modeRevision: 2,
    label: 'Test durable mode',
    affinity: 0.72,
    matchedCanonicalIds: ['canonical:test'],
    sourceNodeIds: ['topic:test'],
  }]);
});

test('durable active mode score is split across exact canonical members and source graph nodes', () => {
  const fixture = structuredClone(state);
  fixture.graph.nodes.push(
    {
      id: 'topic:crdts',
      kind: 'topic',
      label: 'CRDTs',
      provenance: 'inferred',
      confidence: 0.9,
      attributes: { sourceKinds: ['model_topic'] },
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    },
    {
      id: 'topic:replication',
      kind: 'topic',
      label: 'Replication',
      provenance: 'inferred',
      confidence: 0.9,
      attributes: { sourceKinds: ['model_topic'] },
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    },
  );
  fixture.graph.edges.push(
    {
      id: 'edge:mode:crdts',
      sourceNodeId: 'topic:crdts',
      targetNodeId: 'content:youtube:video-a',
      relation: 'about',
      provenance: 'inferred',
      confidence: 0.9,
      evidenceIds: ['e-mode-crdts'],
      attributes: {},
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    },
    {
      id: 'edge:mode:replication',
      sourceNodeId: 'topic:replication',
      targetNodeId: 'content:youtube:video-a',
      relation: 'about',
      provenance: 'inferred',
      confidence: 0.9,
      evidenceIds: ['e-mode-replication'],
      attributes: {},
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    },
  );
  fixture.graph.currentRevision += 1;

  const activeMode = {
    id: 'mode:inferred:v1:systems',
    label: 'Distributed systems',
    revision: 2,
  };
  const ranked = scoreLocalCandidates(fixture, [{
    external_id: 'mode-grounded',
    title: 'Neutral candidate',
    semantic_mode_similarity: 0.95,
    semantic_model_version: 'fixture-model@v2',
    semantic_mode_affinities: [
      {
        modeId: 'mode:inferred:v1:other',
        modeRevision: 1,
        label: 'Other mode',
        affinity: 0.9,
        matchedCanonicalIds: ['canonical:other'],
        sourceNodeIds: ['topic:other'],
        memberAffinities: [{
          canonicalId: 'canonical:other',
          label: 'Other',
          memberWeight: 1,
          similarity: 0.9,
          weightedAffinity: 0.9,
          sourceNodeIds: ['topic:other'],
        }],
      },
      {
        modeId: activeMode.id,
        modeRevision: activeMode.revision,
        label: activeMode.label,
        affinity: 0.6,
        matchedCanonicalIds: ['canonical:crdts', 'canonical:replication'],
        sourceNodeIds: ['topic:crdts', 'topic:replication'],
        memberAffinities: [
          {
            canonicalId: 'canonical:crdts',
            label: 'CRDTs',
            memberWeight: 1,
            similarity: 0.6,
            weightedAffinity: 0.6,
            sourceNodeIds: ['topic:crdts'],
          },
          {
            canonicalId: 'canonical:replication',
            label: 'Replication',
            memberWeight: 0.5,
            similarity: 0.6,
            weightedAffinity: 0.3,
            sourceNodeIds: ['topic:replication'],
          },
        ],
      },
    ],
  }], activeMode.label, [], {}, activeMode)[0];

  assert.equal(ranked.rawScore, 8.4);
  assert.equal(
    ranked.trace.featureContributions.some((item) => item.label === 'semantic match: active mode'),
    false,
  );
  assert.equal(ranked.trace.modeContributions.length, 2);
  assert.deepEqual(
    ranked.trace.modeContributions.map((item) => ({
      value: item.value,
      modeId: item.modeId,
      modeRevision: item.modeRevision,
      canonicalId: item.canonicalId,
      sourceIds: item.sourceIds,
      evidenceIds: item.evidenceIds,
    })),
    [
      {
        value: 5.6,
        modeId: activeMode.id,
        modeRevision: 2,
        canonicalId: 'canonical:crdts',
        sourceIds: ['topic:crdts'],
        evidenceIds: ['e-mode-crdts'],
      },
      {
        value: 2.8,
        modeId: activeMode.id,
        modeRevision: 2,
        canonicalId: 'canonical:replication',
        sourceIds: ['topic:replication'],
        evidenceIds: ['e-mode-replication'],
      },
    ],
  );

  const modeContributions = ranked.trace.modeContributions;
  const metrics = evaluateModeTraceGrounding([{
    traceId: ranked.trace.id,
    modeContribution: modeContributions.reduce((sum, item) => sum + item.value, 0),
    modeId: activeMode.id,
    modeRevision: activeMode.revision,
    contributingNodeIds: [...new Set(modeContributions.flatMap((item) => item.sourceIds ?? []))],
    memberContributions: modeContributions.map((item) => item.value),
  }]);
  assert.equal(metrics.groundingRate, 1);
  assert.equal(metrics.reconciliationRate, 1);
});

test('durable mode revision mismatch abstains instead of using stale or free-floating mode similarity', () => {
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'stale-mode-affinity',
    title: 'Learn Rust with a complete tutorial',
    semantic_mode_similarity: 0.95,
    semantic_mode_affinities: [{
      modeId: 'mode:inferred:v1:learning',
      modeRevision: 1,
      label: 'Learning',
      affinity: 0.8,
      matchedCanonicalIds: ['canonical:learning'],
      sourceNodeIds: ['topic:learning'],
      memberAffinities: [{
        canonicalId: 'canonical:learning',
        label: 'Learning',
        memberWeight: 1,
        similarity: 0.8,
        weightedAffinity: 0.8,
        sourceNodeIds: ['topic:learning'],
      }],
    }],
  }], 'Learning', [], {}, {
    id: 'mode:inferred:v1:learning',
    label: 'Learning',
    revision: 2,
  })[0];

  assert.equal(ranked.trace.modeContributions.length, 0);
  assert.equal(
    ranked.trace.featureContributions.some((item) => (
      item.label === 'semantic match: active mode'
      || item.label === 'mode alignment: learning'
      || item.label === 'semantic category: learning'
    )),
    false,
  );
});

test('durable mode scoring abstains when affinity provenance no longer resolves to current graph nodes', () => {
  const activeMode = {
    id: 'mode:inferred:v1:missing-source',
    label: 'Missing source mode',
    revision: 3,
  };
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'missing-source-affinity',
    title: 'Neutral candidate',
    semantic_mode_similarity: 0.9,
    semantic_mode_affinities: [{
      modeId: activeMode.id,
      modeRevision: activeMode.revision,
      label: activeMode.label,
      affinity: 0.8,
      matchedCanonicalIds: ['canonical:missing'],
      sourceNodeIds: ['topic:removed-from-graph'],
      memberAffinities: [{
        canonicalId: 'canonical:missing',
        label: 'Removed concept',
        memberWeight: 1,
        similarity: 0.8,
        weightedAffinity: 0.8,
        sourceNodeIds: ['topic:removed-from-graph'],
      }],
    }],
  }], activeMode.label, [], {}, activeMode)[0];

  assert.equal(ranked.trace.modeContributions.length, 0);
  assert.equal(
    ranked.trace.featureContributions.some((item) => (
      item.label === 'semantic match: active mode'
    )),
    false,
  );
});

test('removed strongest member cannot transfer its mode budget to a weaker grounded member', () => {
  const fixture = structuredClone(state);
  fixture.graph.nodes.push({
    id: 'topic:surviving',
    kind: 'topic',
    label: 'Surviving concept',
    provenance: 'inferred',
    confidence: 0.9,
    attributes: { sourceKinds: ['model_topic'] },
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
  });
  fixture.graph.edges.push({
    id: 'edge:mode:surviving',
    sourceNodeId: 'topic:surviving',
    targetNodeId: 'content:youtube:video-a',
    relation: 'about',
    provenance: 'inferred',
    confidence: 0.9,
    evidenceIds: ['e-mode-surviving'],
    attributes: {},
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
  });
  fixture.graph.currentRevision += 1;

  const activeMode = {
    id: 'mode:inferred:v1:partial-stale',
    label: 'Partial stale mode',
    revision: 4,
  };
  const ranked = scoreLocalCandidates(fixture, [{
    external_id: 'partial-stale-affinity',
    title: 'Neutral candidate',
    semantic_mode_affinities: [{
      modeId: activeMode.id,
      modeRevision: activeMode.revision,
      label: activeMode.label,
      affinity: 0.9,
      matchedCanonicalIds: ['canonical:removed', 'canonical:surviving'],
      sourceNodeIds: ['topic:removed', 'topic:surviving'],
      memberAffinities: [
        {
          canonicalId: 'canonical:removed',
          label: 'Removed strongest',
          memberWeight: 1,
          similarity: 0.9,
          weightedAffinity: 0.9,
          sourceNodeIds: ['topic:removed'],
        },
        {
          canonicalId: 'canonical:surviving',
          label: 'Surviving concept',
          memberWeight: 0.5,
          similarity: 0.6,
          weightedAffinity: 0.3,
          sourceNodeIds: ['topic:surviving'],
        },
      ],
    }],
  }], activeMode.label, [], {}, activeMode)[0];

  assert.equal(ranked.trace.modeContributions.length, 1);
  assert.equal(ranked.trace.modeContributions[0].canonicalId, 'canonical:surviving');
  assert.equal(ranked.trace.modeContributions[0].value, 4.2);
  assert.deepEqual(ranked.trace.modeContributions[0].sourceIds, ['topic:surviving']);
});



test('explicit local feedback changes the score without treating watch evidence as preference', () => {
  const signals = buildLocalFeedbackSignals([
    { contentItemId: 'video-b', eventType: 'more_like_this' },
  ]);
  const ranked = scoreLocalCandidates(state, [
    { external_id: 'video-a', title: 'Video A' },
    { external_id: 'video-b', title: 'Video B' },
  ], 'Work', signals);

  assert.equal(ranked[0].external_id, 'video-b');
  assert.equal(ranked[0].external_id, 'video-b');
  assert.equal(ranked[0].rawScore, 21);
  assert.equal(ranked[0].score, calibrateLocalScore(21));
  assert.equal(ranked[1].rawScore, 11);
});

test('explicit not-interested feedback lowers the matching candidate score', () => {
  const signals = buildLocalFeedbackSignals([
    { contentItemId: 'video-b', eventType: 'not_interested' },
  ]);
  const ranked = scoreLocalCandidates(state, [
    { external_id: 'video-a', title: 'Video A' },
    { external_id: 'video-b', title: 'Video B' },
  ], 'Work', signals);

  assert.equal(ranked[0].external_id, 'video-a');
  assert.equal(ranked[0].rawScore, 11);
  assert.equal(ranked[1].external_id, 'video-b');
  assert.equal(ranked[1].rawScore, -24);
  assert.equal(ranked[1].trace.feedbackContributions.length, 1);
  assert.equal(ranked[1].trace.feedbackContributions[0].value, -25);
});

test('duplicate feedback is reconciled to the latest event for a content item', () => {
  const signals = buildLocalFeedbackSignals([
    { contentItemId: 'video-b', eventType: 'not_interested', recordedAt: '2026-09-26T01:00:00.000Z' },
    { contentItemId: 'video-b', eventType: 'not_interested', recordedAt: '2026-09-26T01:01:00.000Z' },
  ]);
  assert.equal(signals.length, 1);
  const ranked = scoreLocalCandidates(state, [
    { external_id: 'video-a', title: 'Video A' },
    { external_id: 'video-b', title: 'Video B' },
  ], 'Work', signals);
  assert.equal(ranked.find((item) => item.external_id === 'video-b')?.rawScore, -24);
});

test('never-show-channel feedback matches the creator node rather than only the source video', () => {
  const signals = buildLocalFeedbackSignals([
    { contentItemId: 'video-a', eventType: 'never_show_channel', recordedAt: '2026-09-26T01:00:00.000Z' },
  ], state);
  const ranked = scoreLocalCandidates(state, [
    { external_id: 'video-a', title: 'Video A' },
    { external_id: 'video-b', title: 'Video B' },
    { external_id: 'video-c', title: 'Video C' },
  ], 'Work', signals);
  assert.equal(signals[0].nodeId, 'creator:youtube:Creator%20A');
  assert.equal(ranked.find((item) => item.external_id === 'video-a')?.rawScore, -89);
  assert.equal(ranked.find((item) => item.external_id === 'video-c')?.rawScore, -89);
});

test('subscription and discovery filters apply to source-tagged candidates', () => {
  const ranked = scoreLocalCandidates(state, [
    { external_id: 'video-a', title: 'Video A', source_kind: 'subscription' },
    { external_id: 'video-b', title: 'Video B', source_kind: 'discovery' },
    { external_id: 'video-c', title: 'Video C', source_kind: 'liked' },
  ], 'Work', [], { subscribedOnly: true, includeDiscovery: false });
  assert.equal(ranked.find((item) => item.external_id === 'video-a')?.visible, true);
  assert.equal(ranked.find((item) => item.external_id === 'video-b')?.visible, false);
  assert.equal(ranked.find((item) => item.external_id === 'video-c')?.visible, false);
});

test('source filters remain local visibility rules', () => {
  const ranked = scoreLocalCandidates(state, [
    { external_id: 'video-a', title: 'Video A', is_short: true },
    { external_id: 'video-b', title: 'Video B' },
  ], 'Work', [], { includeShorts: false });

  assert.equal(ranked.find((item) => item.external_id === 'video-a')?.visible, false);
  assert.equal(ranked.find((item) => item.external_id === 'video-b')?.visible, true);
});

test('local policy is graph-derived and does not use candidate base scores', () => {
  const policy = buildLocalScoringPolicy(state);
  assert.equal(policy.baseScore, 0);
  assert.equal(policy.nodeWeights?.['content:youtube:video-a'], 1);
  assert.equal(policy.nodeWeights?.['creator:youtube:Creator%20A'], 8);
  assert.equal(policy.edgeRelationWeights?.created_by, 2);
});


test('newly acquired videos can score through an already known creator node', () => {
  const acquired = scoreLocalCandidates(state, [
    {
      external_id: 'rss-new-video',
      title: 'New RSS video',
      channel_id: 'Creator A',
      source_kind: 'discovery',
    },
  ], 'Learning');

  assert.equal(acquired[0].rawScore, 8);
  assert.equal(acquired[0].score, calibrateLocalScore(8));
  assert.equal(acquired[0].trace.nodeContributions.length, 1);
  assert.equal(acquired[0].trace.nodeContributions[0].sourceId, 'creator:youtube:Creator%20A');
  assert.equal(acquired[0].trace.edgeContributions.length, 0);
});


test('candidate feature extraction adds deterministic graph and freshness features', () => {
  const featureState = structuredClone(state);
  featureState.graph.nodes.push(
    {
      id: 'objective:learn-ai',
      kind: 'objective',
      label: 'Learn AI',
      provenance: 'explicit',
      confidence: 1,
      attributes: { format: 'tutorial' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'topic:ai-agents',
      kind: 'topic',
      label: 'AI agents',
      provenance: 'explicit',
      confidence: 0.8,
      attributes: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  );
  const extracted = extractLocalCandidateFeatures(featureState, {
    external_id: 'candidate',
    title: 'Learn AI agents: complete tutorial',
    published_at: '2026-09-25T12:00:00.000Z',
    lastSeenAt: '2026-09-26T10:00:00.000Z',
  });

  assert.equal(extracted.nodeIds.includes('objective:learn-ai'), true);
  assert.equal(extracted.nodeIds.includes('topic:ai-agents'), true);
  assert.equal(extracted.features.some((item) => item.label === 'format match: tutorial'), true);
  assert.equal(extracted.features.some((item) => item.id === 'freshness'), true);
});

test('calibrated scores are deterministic, monotonic, and bounded', () => {
  assert.equal(calibrateLocalScore(0), 50);
  assert.ok(calibrateLocalScore(20) > calibrateLocalScore(10));
  assert.ok(calibrateLocalScore(-20) < calibrateLocalScore(-10));
  assert.ok(calibrateLocalScore(1000) <= 100);
  assert.ok(calibrateLocalScore(-1000) >= 0);
});


test('score calibration diagnostics expose post-canonical distribution and threshold pressure', () => {
  const rawScores = [-30, -10, 0, 5, 10, 20, 30, 40, 60, 90];
  const diagnostics = summarizeLocalScoreCalibration(
    rawScores.map((rawScore) => ({
      rawScore,
      score: calibrateLocalScore(rawScore),
    })),
    55,
    5,
    50,
  );

  assert.equal(diagnostics.count, 10);
  assert.equal(diagnostics.raw.min, -30);
  assert.equal(diagnostics.raw.p50, 10);
  assert.equal(diagnostics.raw.p95, 90);
  assert.equal(diagnostics.raw.max, 90);
  assert.equal(diagnostics.display.min, calibrateLocalScore(-30));
  assert.equal(diagnostics.display.p50, calibrateLocalScore(10));
  assert.equal(diagnostics.display.max, calibrateLocalScore(90));
  assert.ok(diagnostics.display.saturation95Rate > 0);
  assert.equal(diagnostics.replacement.baseMinimumScore, 55);
  assert.equal(diagnostics.replacement.effectiveMinimumScore, 27.5);
  assert.equal(diagnostics.replacement.minimumUplift, 5);
  assert.equal(diagnostics.replacement.replacementPercent, 50);
  assert.ok(diagnostics.replacement.qualifiedRate > 0);
  assert.equal(
    diagnostics.replacement.medianHeadroom,
    calibrateLocalScore(10) - 27.5,
  );
});

test('score calibration diagnostics are empty-safe and deterministic', () => {
  assert.deepEqual(
    summarizeLocalScoreCalibration([], 55, 5),
    {
      count: 0,
      raw: { min: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, max: 0 },
      display: {
        min: 0,
        p25: 0,
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        max: 0,
        distinct: 0,
        tieRate: 0,
        saturation95Rate: 0,
        saturation97Rate: 0,
        saturation99Rate: 0,
      },
      replacement: {
        baseMinimumScore: 55,
        effectiveMinimumScore: 55,
        minimumUplift: 5,
        replacementPercent: 0,
        qualifiedRate: 0,
        medianHeadroom: 0,
      },
    },
  );
});


test('content classification is independent of active mode and only labels strong learning evidence', () => {
  assert.deepEqual(
    classifyCandidateContent({
      external_id: 'learning-video',
      title: 'Distributed systems tutorial',
      content_type: 'Education',
    }),
    { label: 'learning', confidence: 0.92 },
  );
  assert.equal(
    classifyCandidateContent({
      external_id: 'unknown-video',
      title: 'Weekly update',
    }).label,
    null,
  );
});

test('matching mode adds a traceable alignment feature without relabeling unrelated content', () => {
  const learning = scoreLocalCandidates(state, [{
    external_id: 'new-learning',
    title: 'Learn Rust with a complete tutorial',
  }], 'Learning')[0];
  const work = scoreLocalCandidates(state, [{
    external_id: 'new-learning',
    title: 'Learn Rust with a complete tutorial',
  }], 'Work')[0];

  assert.equal(learning.content_label, 'learning');
  assert.ok(learning.rawScore > work.rawScore);
  assert.equal(
    learning.trace.featureContributions.some((item) => item.label === 'mode alignment: learning'),
    true,
  );
  assert.equal(
    work.trace.featureContributions.some((item) => item.label === 'mode alignment: learning'),
    false,
  );
});


test('semantic graph and mode similarities become exact trace contributions when graph provenance is available', () => {
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'semantic-video',
    title: 'A semantically relevant candidate',
    semantic_graph_similarity: 0.75,
    semantic_mode_similarity: 0.6,
    semantic_model_version: 'mxbai-xsmall:test',
    semantic_graph_matches: [{
      node_id: 'topic:fixture',
      node_label: 'Fixture topic',
      similarity: 0.75,
      weight: 0.75,
      canonical_id: 'canonical:fixture',
      source_node_ids: ['topic:fixture'],
    }],
  }], 'Learning')[0];

  const graphFeature = ranked.trace.featureContributions
    .find((item) => item.sourceId === 'canonical:fixture');
  const modeFeature = ranked.trace.featureContributions
    .find((item) => item.label === 'semantic match: active mode');

  assert.equal(graphFeature?.value, 13.5);
  assert.deepEqual(graphFeature?.sourceIds, ['topic:fixture']);
  assert.equal(modeFeature?.value, 8.4);
  assert.equal(modeFeature?.sourceId, 'embedding:mxbai-xsmall:test');
});

test('active semantic category reranks candidates with an exact contribution', () => {
  const candidates = [
    { external_id: 'study', title: 'Untitled A', semantic_category_scores: { learning: 0.8, gaming: 0.4 } },
    { external_id: 'game', title: 'Untitled B', semantic_category_scores: { learning: 0.4, gaming: 0.8 } },
  ];
  const learning = scoreLocalCandidates(state, candidates, 'Learning');
  const gaming = scoreLocalCandidates(state, candidates, 'Gaming');
  assert.equal(learning[0].external_id, 'study');
  assert.equal(gaming[0].external_id, 'game');
  assert.ok(learning[0].trace.featureContributions.some((item) => item.label === 'semantic category: learning'));
  assert.ok(gaming[0].trace.featureContributions.some((item) => item.label === 'semantic category: gaming'));
});

test('semantic similarities below threshold do not affect ranking', () => {
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'weak-semantic-video',
    title: 'Weak semantic candidate',
    semantic_graph_similarity: 0.19,
    semantic_mode_similarity: 0.1,
    semantic_model_version: 'mxbai-xsmall:test',
  }], 'Work')[0];

  assert.equal(
    ranked.trace.featureContributions.some((item) => item.id.startsWith('semantic:')),
    false,
  );
});


test('semantic mode similarity replaces the legacy heuristic mode boost instead of double-counting mode intent', () => {
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'semantic-learning',
    title: 'Learn Rust with a complete tutorial',
    semantic_mode_similarity: 0.8,
    semantic_graph_similarity: 0.4,
    semantic_model_version: 'fixture-v1',
  }], 'Learning')[0];

  assert.equal(
    ranked.trace.featureContributions.some((item) => item.label === 'mode alignment: learning'),
    false,
  );
  assert.equal(
    ranked.trace.featureContributions.some((item) => item.label === 'semantic match: active mode'),
    true,
  );
});


test('semantic graph matches become canonical trace contributions without changing total graph weight', () => {
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'semantic-symbolic',
    title: 'Distributed systems and local-first software design',
    semantic_graph_similarity: 0.75,
    semantic_mode_similarity: 0,
    semantic_model_version: 'fixture-model@v1',
    semantic_graph_matches: [
      {
        node_id: 'objective:systems',
        node_label: 'Distributed systems',
        similarity: 0.8,
        weight: 0.8,
        canonical_id: 'canonical:systems',
        source_node_ids: ['objective:systems'],
      },
      {
        node_id: 'topic:local-first',
        node_label: 'Local-first software',
        similarity: 0.4,
        weight: 0.4,
        canonical_id: 'canonical:local-first',
        source_node_ids: ['topic:local-first'],
      },
    ],
  }], 'Work')[0];

  const graphFeatures = ranked.trace.featureContributions
    .filter((item) => item.id.startsWith('feature:semantic-neighbourhood:'));
  assert.equal(graphFeatures.length, 2);
  assert.equal(graphFeatures.some((item) => item.sourceId === 'canonical:systems'), true);
  assert.equal(graphFeatures.some((item) => item.sourceId === 'canonical:local-first'), true);
  const total = graphFeatures.reduce((sum, item) => sum + item.value, 0);
  assert.ok(Math.abs(total - 13.5) <= 0.01);
});


const semanticFixtureState = () => {
  const fixture = structuredClone(state);
  fixture.graph.nodes.push(
    {
      id: 'topic:grok-bot',
      kind: 'topic',
      label: 'grok bot',
      provenance: 'inferred',
      confidence: 0.82,
      attributes: { sourceKinds: ['model_topic'] },
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    },
    {
      id: 'topic:grok-how',
      kind: 'topic',
      label: 'how to use grok bot',
      provenance: 'inferred',
      confidence: 0.82,
      attributes: { sourceKinds: ['model_topic'] },
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    },
    {
      id: 'topic:grok-cases',
      kind: 'topic',
      label: 'grok bot use cases',
      provenance: 'inferred',
      confidence: 0.82,
      attributes: { sourceKinds: ['model_topic'] },
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    },
    {
      id: 'topic:grok-tutorial',
      kind: 'topic',
      label: 'grok bot tutorial',
      provenance: 'inferred',
      confidence: 0.82,
      attributes: { sourceKinds: ['model_topic'] },
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    },
    {
      id: 'concept:education',
      kind: 'concept',
      label: 'Education',
      provenance: 'inferred',
      confidence: 0.72,
      attributes: { sourceKinds: ['content_type'] },
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    },
  );
  for (const nodeId of [
    'topic:grok-bot',
    'topic:grok-how',
    'topic:grok-cases',
    'topic:grok-tutorial',
    'concept:education',
  ]) {
    fixture.graph.edges.push({
      id: `edge:about:${nodeId}`,
      sourceNodeId: nodeId,
      targetNodeId: 'content:youtube:video-a',
      relation: 'about',
      provenance: 'inferred',
      confidence: 0.8,
      evidenceIds: [`evidence:${nodeId}`],
      attributes: {},
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    });
  }
  fixture.graph.currentRevision += 1;
  return fixture;
};

test('Grok aliases emit one bounded canonical contribution with exact source-node provenance', () => {
  const fixture = semanticFixtureState();
  const ranked = scoreLocalCandidates(fixture, [{
    external_id: 'grok-candidate',
    title: 'Grok bot tutorial: how to use Grok bot and practical use cases',
  }], 'Default')[0];

  const semantic = ranked.trace.featureContributions
    .filter((item) => item.id.startsWith('feature:semantic-neighbourhood:'));
  assert.equal(semantic.length, 1);
  assert.equal(semantic[0].value, 11.48);
  assert.deepEqual(semantic[0].sourceIds, [
    'topic:grok-bot',
    'topic:grok-cases',
    'topic:grok-how',
    'topic:grok-tutorial',
  ]);
});

test('lexical and embedding evidence for the same canonical neighbourhood reconcile instead of stacking', () => {
  const fixture = semanticFixtureState();
  const lexicalOnly = scoreLocalCandidates(fixture, [{
    external_id: 'grok-lexical',
    title: 'Grok bot tutorial and use cases',
  }], 'Default')[0];
  const lexicalFeature = lexicalOnly.trace.featureContributions
    .find((item) => item.id.startsWith('feature:semantic-neighbourhood:'));
  assert.ok(lexicalFeature);

  const ranked = scoreLocalCandidates(fixture, [{
    external_id: 'grok-combined',
    title: 'Grok bot tutorial and use cases',
    semantic_graph_similarity: 0.9,
    semantic_model_version: 'fixture-mxbai@v1',
    semantic_graph_matches: [{
      node_id: 'topic:grok-bot',
      node_label: 'grok bot',
      similarity: 0.9,
      weight: 0.9,
      canonical_id: lexicalFeature.sourceId,
      source_node_ids: [
        'topic:grok-bot',
        'topic:grok-cases',
        'topic:grok-how',
        'topic:grok-tutorial',
      ],
    }],
  }], 'Default')[0];

  const semantic = ranked.trace.featureContributions
    .filter((item) => item.id.startsWith('feature:semantic-neighbourhood:'));
  assert.equal(semantic.length, 1);
  assert.equal(semantic[0].value, 16.2);
  assert.ok(semantic[0].value < Number((11.48 + 16.2).toFixed(2)));
});

test('broad content-type taxonomy does not add preference mass beside a specific semantic match', () => {
  const fixture = semanticFixtureState();
  const ranked = scoreLocalCandidates(fixture, [{
    external_id: 'taxonomy-candidate',
    title: 'Education: Grok bot tutorial',
  }], 'Default')[0];

  const semantic = ranked.trace.featureContributions
    .filter((item) => item.id.startsWith('feature:semantic-neighbourhood:'));
  assert.equal(semantic.length, 1);
  assert.equal(semantic[0].sourceIds.includes('concept:education'), false);
  assert.equal(semantic[0].sourceIds.includes('topic:grok-bot'), true);
});


test('independent canonical neighbourhoods retain separate bounded contributions', () => {
  const fixture = semanticFixtureState();
  fixture.graph.nodes.push({
    id: 'topic:ceramics',
    kind: 'topic',
    label: 'ceramic glazing',
    provenance: 'inferred',
    confidence: 0.8,
    attributes: { sourceKinds: ['model_topic'] },
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
  });

  const ranked = scoreLocalCandidates(fixture, [{
    external_id: 'multi-interest',
    title: 'Grok bot tutorial plus ceramic glazing',
  }], 'Default')[0];
  const semantic = ranked.trace.featureContributions
    .filter((item) => item.id.startsWith('feature:semantic-neighbourhood:'));

  assert.equal(semantic.length, 2);
  assert.ok(semantic.reduce((sum, item) => sum + item.value, 0) > 18);
  assert.ok(semantic.every((item) => item.value <= 18));
});


test('nested live-style lofi concepts collapse into one bounded scoring region', () => {
  const fixture = structuredClone(state);
  for (const [id, label] of [
    ['topic:chill-lofi', 'chill lofi'],
    ['topic:chill-lofi-beats', 'chill lofi beats'],
    ['topic:lofi-beats', 'lofi beats'],
  ]) {
    fixture.graph.nodes.push({
      id,
      kind: 'topic',
      label,
      provenance: 'inferred',
      confidence: 0.9,
      attributes: { sourceKinds: ['model_topic'] },
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    });
  }

  const ranked = scoreLocalCandidates(fixture, [{
    external_id: 'lofi-live-regression',
    title: 'Chill lofi beats and lofi beats mix for sleep',
  }], 'Default')[0];
  const semantic = ranked.trace.featureContributions
    .filter((item) => item.id.startsWith('feature:semantic-neighbourhood:'));

  assert.equal(semantic.length, 1);
  assert.equal(semantic[0].value, 12.6);
  assert.ok(semantic[0].sourceId.startsWith('canonical:semantic:score-region:v1:'));
  assert.deepEqual(semantic[0].sourceIds, [
    'topic:chill-lofi',
    'topic:chill-lofi-beats',
    'topic:lofi-beats',
  ]);
});

test('weak relative embedding neighbours do not receive score mass beside a strong match', () => {
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'game-boy-regression',
    title: 'Game Boy Games on a graphing calculator',
    semantic_graph_similarity: 0.6,
    semantic_model_version: 'fixture-mxbai@v1',
    semantic_graph_matches: [
      {
        node_id: 'topic:games',
        node_label: 'games',
        similarity: 0.65,
        weight: 0.65,
        canonical_id: 'canonical:games',
        source_node_ids: ['topic:games'],
      },
      {
        node_id: 'topic:homeless-couple',
        node_label: 'Homeless Couple',
        similarity: 0.42,
        weight: 0.42,
        canonical_id: 'canonical:homeless-couple',
        source_node_ids: ['topic:homeless-couple'],
      },
    ],
  }], 'Default')[0];

  const semantic = ranked.trace.featureContributions
    .filter((item) => item.id.startsWith('feature:semantic-neighbourhood:'));
  assert.equal(semantic.length, 1);
  assert.equal(semantic[0].sourceId, 'canonical:games');
  assert.equal(
    semantic.some((item) => item.label.includes('Homeless Couple')),
    false,
  );
});


test('flat low-confidence semantic profiles abstain from embedding-only score mass', () => {
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'false-hero-live-regression',
    title: 'False Hero indie souls livestream',
    semantic_graph_similarity: 0.3351,
    semantic_model_version: 'fixture-mxbai@v1',
    semantic_graph_matches: [
      {
        node_id: 'topic:silent-hill',
        node_label: 'Silent Hill Townfall PS5 Gameplay',
        similarity: 0.3446,
        weight: 0.3249,
        canonical_id: 'canonical:silent-hill',
        source_node_ids: ['topic:silent-hill'],
      },
      {
        node_id: 'topic:games',
        node_label: 'games',
        similarity: 0.3359,
        weight: 0.3322,
        canonical_id: 'canonical:games',
        source_node_ids: ['topic:games'],
      },
      {
        node_id: 'topic:videogames',
        node_label: 'this week in videogames',
        similarity: 0.3247,
        weight: 0.3061,
        canonical_id: 'canonical:videogames',
        source_node_ids: ['topic:videogames'],
      },
    ],
  }], 'Default')[0];

  const semantic = ranked.trace.featureContributions
    .filter((item) => item.id.startsWith('feature:semantic-neighbourhood:'));
  assert.deepEqual(semantic, []);
});

test('alias-close top matches use the independent scoring region as runner-up', () => {
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'alias-margin-regression',
    title: 'Ambient sleep mix',
    semantic_graph_similarity: 0.55,
    semantic_model_version: 'fixture-mxbai@v1',
    semantic_graph_matches: [
      {
        node_id: 'topic:chill-lofi-beats',
        node_label: 'chill lofi beats',
        similarity: 0.6,
        weight: 0.6,
        canonical_id: 'canonical:chill-lofi-beats',
        source_node_ids: ['topic:chill-lofi-beats'],
      },
      {
        node_id: 'topic:lofi-beats',
        node_label: 'lofi beats',
        similarity: 0.58,
        weight: 0.58,
        canonical_id: 'canonical:lofi-beats',
        source_node_ids: ['topic:lofi-beats'],
      },
      {
        node_id: 'topic:games',
        node_label: 'games',
        similarity: 0.2,
        weight: 0.2,
        canonical_id: 'canonical:games',
        source_node_ids: ['topic:games'],
      },
    ],
  }], 'Default')[0];

  const semantic = ranked.trace.featureContributions
    .filter((item) => item.id.startsWith('feature:semantic-neighbourhood:'));
  assert.equal(semantic.length, 1);
  assert.ok(semantic[0].sourceId.startsWith('canonical:semantic:score-region:v1:'));
  assert.deepEqual(semantic[0].sourceIds, [
    'topic:chill-lofi-beats',
    'topic:lofi-beats',
  ]);
});

test('single generic words do not partially match multi-token semantic labels', () => {
  const fixture = structuredClone(state);
  for (const [id, label] of [
    ['topic:homeless-couple', 'Homeless Couple'],
    ['topic:grm-daily', 'GRM Daily'],
    ['topic:week-videogames', 'this week in videogames'],
  ]) {
    fixture.graph.nodes.push({
      id,
      kind: 'topic',
      label,
      provenance: 'inferred',
      confidence: 0.9,
      attributes: { sourceKinds: ['model_topic'] },
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    });
  }

  const falsePositive = scoreLocalCandidates(fixture, [{
    external_id: 'partial-token-regression',
    title: 'A daily update for a couple of projects this week',
  }], 'Default')[0];
  assert.equal(
    falsePositive.trace.featureContributions.some((item) => (
      item.id.startsWith('feature:semantic-neighbourhood:')
    )),
    false,
  );

  const exact = scoreLocalCandidates(fixture, [{
    external_id: 'exact-token-control',
    title: 'GRM Daily interview',
  }], 'Default')[0];
  assert.equal(
    exact.trace.featureContributions.some((item) => item.label.includes('GRM Daily')),
    true,
  );
});


test('lexical grounding stays within trusted fields and does not use description token soup', () => {
  const fixture = structuredClone(state);
  fixture.graph.nodes.push({
    id: 'topic:homeless-couple',
    kind: 'topic',
    label: 'Homeless Couple',
    provenance: 'inferred',
    confidence: 0.92,
    attributes: { sourceKinds: ['model_topic'] },
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
  });

  const scattered = scoreLocalCandidates(fixture, [{
    external_id: 'scattered-field-regression',
    title: 'Cooking meals for the homeless',
    description: 'A couple of volunteers helped prepare everything over several days.',
    topics: ['community cooking'],
  }], 'Default')[0];
  assert.equal(
    scattered.trace.featureContributions.some((item) => item.label.includes('Homeless Couple')),
    false,
  );

  const descriptionOnly = scoreLocalCandidates(fixture, [{
    external_id: 'description-only-regression',
    title: 'Community meal preparation',
    description: 'A Homeless Couple appears briefly in the background.',
    topics: ['community cooking'],
  }], 'Default')[0];
  assert.equal(
    descriptionOnly.trace.featureContributions.some((item) => item.label.includes('Homeless Couple')),
    false,
  );

  const topicPhrase = scoreLocalCandidates(fixture, [{
    external_id: 'trusted-field-control',
    title: 'Community meal preparation',
    topics: ['Homeless Couple'],
  }], 'Default')[0];
  assert.equal(
    topicPhrase.trace.featureContributions.some((item) => item.label.includes('Homeless Couple')),
    true,
  );
});

test('taxonomy-only semantic matches share one collective bounded fallback contribution', () => {
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'taxonomy-only-regression',
    title: 'A generic candidate without a specific graph concept',
    semantic_graph_similarity: 0.6,
    semantic_model_version: 'fixture-mxbai@v1',
    semantic_graph_matches: [
      {
        node_id: 'concept:education',
        node_label: 'Education',
        similarity: 0.6,
        weight: 0.6,
        canonical_id: 'canonical:education',
        source_node_ids: ['concept:education'],
        taxonomy_only: true,
      },
      {
        node_id: 'concept:music',
        node_label: 'Music',
        similarity: 0.55,
        weight: 0.55,
        canonical_id: 'canonical:music',
        source_node_ids: ['concept:music'],
        taxonomy_only: true,
      },
      {
        node_id: 'concept:people-blogs',
        node_label: 'People & Blogs',
        similarity: 0.52,
        weight: 0.52,
        canonical_id: 'canonical:people-blogs',
        source_node_ids: ['concept:people-blogs'],
        taxonomy_only: true,
      },
    ],
  }], 'Default')[0];

  const semantic = ranked.trace.featureContributions
    .filter((item) => item.id.startsWith('feature:semantic-neighbourhood:'));
  assert.equal(semantic.length, 1);
  assert.match(semantic[0].label, /^semantic taxonomy:/);
  assert.ok(semantic[0].value > 0 && semantic[0].value <= 3);
  assert.deepEqual(semantic[0].sourceIds, [
    'concept:education',
    'concept:music',
    'concept:people-blogs',
  ]);
});


test('incremental scoring reuses unchanged candidate traces and invalidates material changes', () => {
  const candidate = {
    external_id: 'incremental-cache-video',
    title: 'Local AI systems',
    channel_name: 'Example creator',
    firstSeenAt: '2026-09-30T00:00:00.000Z',
    lastSeenAt: '2026-09-30T00:00:00.000Z',
    topics: ['local ai'],
  };

  const first = scoreLocalCandidates(state, [candidate], 'Default')[0];
  const second = scoreLocalCandidates(state, [{ ...candidate }], 'Default')[0];
  assert.equal(second.trace, first.trace);

  const changed = scoreLocalCandidates(state, [{
    ...candidate,
    title: 'Local AI systems updated',
  }], 'Default')[0];
  assert.notEqual(changed.trace, first.trace);
});


test('exposure-only evidence churn reuses candidate preparation but refreshes exact trace revision', () => {
  const candidate = {
    external_id: 'exposure-cache-video',
    title: 'Local AI systems',
    channel_name: 'Example creator',
    firstSeenAt: '2026-09-30T00:00:00.000Z',
    lastSeenAt: '2026-09-30T00:00:00.000Z',
    topics: ['local ai'],
  };
  const baselineState = structuredClone(state);
  baselineState.evidence.push({
    id: 'exposure:one',
    evidence: {
      kind: 'exposure',
      source: 'youtube',
      externalId: 'exposure-cache-video',
      observedAt: '2026-09-30T00:00:00.000Z',
      provenance: {
        connector: 'youtube',
        mechanism: 'home_dom',
      },
      context: {},
    },
    confidence: 1,
    retainedAt: '2026-09-30T00:00:00.000Z',
    retention: { policy: 'default', expiresAt: null },
  });

  const first = scoreLocalCandidates(baselineState, [candidate], 'Default')[0];
  const nextState = structuredClone(baselineState);
  nextState.evidence[0].evidence.observedAt = '2026-09-30T00:01:00.000Z';
  nextState.evidence[0].retainedAt = '2026-09-30T00:01:00.000Z';

  const second = scoreLocalCandidates(nextState, [{ ...candidate }], 'Default')[0];
  const diagnostics = getLocalScoringDiagnostics();

  assert.equal(second.rawScore, first.rawScore);
  assert.notEqual(second.trace.id, first.trace.id);
  assert.equal(diagnostics.cacheHits, 0);
  assert.equal(diagnostics.cacheMisses, 1);
  assert.equal(diagnostics.contextHits, 1);
  assert.equal(diagnostics.contextMisses, 0);
});
