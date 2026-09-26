import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalFeedbackSignals,
  buildLocalScoringPolicy,
  calibrateLocalScore,
  classifyCandidateContent,
  extractLocalCandidateFeatures,
  scoreLocalCandidates,
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
    { external_id: 'video-a', title: 'Video A' },
  ], 'Work');

  assert.equal(ranked[0].external_id, 'video-a');
  assert.equal(ranked[0].rawScore, 11);
  assert.equal(ranked[0].score, calibrateLocalScore(11));
  assert.equal(ranked[0].trace.policyRevision, 'local-mvp-p2');
  assert.equal(ranked[0].trace.graphRevision, 4);
  assert.equal(ranked[0].trace.finalScore, 11);
  assert.equal(ranked[0].trace.edgeContributions.length, 1);
  assert.equal(ranked[0].trace.nodeContributions.length, 2);
  assert.equal(ranked[0].trace.suppressed, false);
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


test('semantic graph and mode similarities become explicit trace contributions', () => {
  const ranked = scoreLocalCandidates(state, [{
    external_id: 'semantic-video',
    title: 'A semantically relevant candidate',
    semantic_graph_similarity: 0.75,
    semantic_mode_similarity: 0.6,
    semantic_model_version: 'mxbai-xsmall:test',
  }], 'Learning')[0];

  const graphFeature = ranked.trace.featureContributions
    .find((item) => item.label === 'semantic match: personal graph');
  const modeFeature = ranked.trace.featureContributions
    .find((item) => item.label === 'semantic match: active mode');

  assert.equal(graphFeature?.value, 13.5);
  assert.equal(modeFeature?.value, 8.4);
  assert.equal(graphFeature?.sourceId, 'embedding:mxbai-xsmall:test');
  assert.equal(modeFeature?.sourceId, 'embedding:mxbai-xsmall:test');
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
