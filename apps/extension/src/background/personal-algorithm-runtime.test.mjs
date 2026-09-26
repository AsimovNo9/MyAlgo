import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLocalFeedbackSignals,
  buildLocalScoringPolicy,
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
  assert.equal(ranked[0].score, 6);
  assert.equal(ranked[0].trace.policyRevision, 'local-mvp-p1');
  assert.equal(ranked[0].trace.graphRevision, 4);
  assert.equal(ranked[0].trace.finalScore, 6);
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
  assert.equal(ranked[0].score, 11);
  assert.equal(ranked[1].score, 6);
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
  assert.equal(ranked[0].score, 6);
  assert.equal(ranked[1].external_id, 'video-b');
  assert.equal(ranked[1].score, -9);
  assert.equal(ranked[1].trace.feedbackContributions.length, 1);
  assert.equal(ranked[1].trace.feedbackContributions[0].value, -10);
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
  assert.equal(ranked.find((item) => item.external_id === 'video-b')?.score, -9);
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
  assert.equal(ranked.find((item) => item.external_id === 'video-a')?.score, -94);
  assert.equal(ranked.find((item) => item.external_id === 'video-c')?.score, -94);
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
  assert.equal(policy.nodeWeights?.['creator:youtube:Creator%20A'], 2);
  assert.equal(policy.edgeRelationWeights?.created_by, 3);
});
