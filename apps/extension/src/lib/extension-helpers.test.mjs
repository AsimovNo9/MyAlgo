import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDurableModeOptions, buildGraphInspectorView, buildGraphModeOverlay, parseGraphInspectorExport, summarizeFeed } from './extension-helpers.ts';

test('summarizeFeed counts sources and ranks topics for visible items only', () => {
  const summary = summarizeFeed([
    { id: '1', external_id: '1', title: 'A', score: 90, visible: true, source_kind: 'subscription', matched_topics: ['AI', 'Engineering'], semantic_category: 'learning', semantic_category_confidence: 0.7 },
    { id: '2', external_id: '2', title: 'B', score: 80, visible: true, source_kind: 'discovery', matched_topics: ['AI'], semantic_category: 'learning', semantic_category_confidence: 0.6 },
    { id: '3', external_id: '3', title: 'C', score: 70, visible: true, source_kind: 'discovery', matched_topics: ['Gaming'], semantic_category: 'gaming', semantic_category_confidence: 0.4 },
    { id: '4', external_id: '4', title: 'D', score: 10, visible: false, source_kind: 'discovery', matched_topics: ['Gossip'] },
  ]);

  assert.equal(summary.subscribedCount, 1);
  assert.equal(summary.discoveredCount, 2);
  assert.deepEqual(summary.topTopics, [
    { topic: 'AI', count: 2 },
    { topic: 'Engineering', count: 1 },
    { topic: 'Gaming', count: 1 },
  ]);
  assert.deepEqual(summary.categories, [{ category: 'learning', count: 2 }, { category: 'gaming', count: 1 }]);
});

test('summarizeFeed handles an empty feed', () => {
  const summary = summarizeFeed([]);

  assert.equal(summary.subscribedCount, 0);
  assert.equal(summary.discoveredCount, 0);
  assert.deepEqual(summary.topTopics, []);
  assert.deepEqual(summary.categories, []);
});


test('buildDurableModeOptions uses persisted stable mode IDs instead of feed categories', () => {
  const catalog = {
    pipelineId: 'durable-semantic-mode-cluster-v1',
    graphRevision: 12,
    generatedAt: '2026-09-27T20:00:00.000Z',
    modes: [
      {
        id: 'mode:inferred:v1:systems',
        label: 'Distributed systems',
        revision: 3,
        members: [],
        provenance: 'inferred',
        pipelineId: 'durable-semantic-mode-cluster-v1',
        graphRevision: 12,
        createdAt: '2026-09-27T19:00:00.000Z',
        lastSupportedAt: '2026-09-27T20:00:00.000Z',
        active: true,
        pinned: false,
      },
      {
        id: 'mode:inferred:v1:ambient',
        label: 'Ambient music',
        revision: 2,
        members: [],
        provenance: 'inferred',
        pipelineId: 'durable-semantic-mode-cluster-v1',
        graphRevision: 12,
        createdAt: '2026-09-27T18:00:00.000Z',
        lastSupportedAt: '2026-09-27T19:30:00.000Z',
        active: false,
        pinned: false,
      },
    ],
  };

  assert.deepEqual(
    buildDurableModeOptions('default', catalog),
    [
      { id: 'default', label: 'All', revision: null, active: true },
      { id: 'mode:inferred:v1:systems', label: 'Distributed systems', revision: 3, active: true },
      { id: 'mode:inferred:v1:ambient', label: 'Ambient music', revision: 2, active: false },
    ],
  );

  assert.deepEqual(
    buildDurableModeOptions('mode:inferred:v1:ambient', catalog),
    [
      { id: 'default', label: 'All', revision: null, active: true },
      { id: 'mode:inferred:v1:systems', label: 'Distributed systems', revision: 3, active: true },
      { id: 'mode:inferred:v1:ambient', label: 'Ambient music', revision: 2, active: false },
    ],
  );
});


test('summarizeFeed discovers recurring mode categories from soft semantic scores without forcing badges', () => {
  const summary = summarizeFeed([
    {
      id: '1', external_id: '1', title: 'A', score: 80, visible: true,
      semantic_category: null, semantic_category_confidence: 0,
      semantic_category_scores: { 'AI tooling': 0.44, 'Web development': 0.31 },
    },
    {
      id: '2', external_id: '2', title: 'B', score: 78, visible: true,
      semantic_category: null, semantic_category_confidence: 0,
      semantic_category_scores: { 'AI tooling': 0.49, 'Personal finance': 0.28 },
    },
    {
      id: '3', external_id: '3', title: 'C', score: 74, visible: true,
      semantic_category: null, semantic_category_confidence: 0,
      semantic_category_scores: { 'Personal finance': 0.45, 'AI tooling': 0.26 },
    },
  ]);

  assert.deepEqual(summary.categories, [
    { category: 'AI tooling', count: 3 },
    { category: 'Personal finance', count: 2 },
  ]);
});


test('graph inspector summarizes nodes, edges, revisions, and supporting evidence', () => {
  const state = {
    schemaVersion: 2,
    evidence: [
      {
        id: 'e1',
        evidence: {
          kind: 'interaction',
          content: { source: 'youtube', externalId: 'video-a' },
          exposureId: null,
          interaction: 'watched',
          observedAt: '2026-09-30T08:00:00.000Z',
          provenance: { connector: 'youtube', mechanism: 'player_watch' },
          metadata: { title: 'Video A', creatorName: 'Creator A' },
        },
        confidence: 1,
        retainedAt: '2026-09-30T08:00:00.000Z',
        retention: { policy: 'default', expiresAt: null },
      },
    ],
    graph: {
      currentRevision: 7,
      userEdits: [],
      revisions: [
        { id: 'r6', revision: 6, reason: 'older', createdAt: '2026-09-30T07:00:00.000Z' },
        { id: 'r7', revision: 7, reason: 'derived_graph_reconcile:test', createdAt: '2026-09-30T08:01:00.000Z' },
      ],
      nodes: [
        {
          id: 'content:youtube:video-a', kind: 'content', label: 'Video A',
          content: { source: 'youtube', externalId: 'video-a' },
          provenance: 'explicit', confidence: null, attributes: {},
          createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:00:00.000Z',
        },
        {
          id: 'creator:youtube:creator-a', kind: 'creator', label: 'Creator A',
          provenance: 'inferred', confidence: 1, attributes: {},
          createdAt: '2026-09-30T08:00:00.000Z', updatedAt: '2026-09-30T08:00:00.000Z',
        },
      ],
      edges: [
        {
          id: 'edge:created_by:a',
          sourceNodeId: 'content:youtube:video-a',
          targetNodeId: 'creator:youtube:creator-a',
          relation: 'created_by',
          provenance: 'inferred',
          confidence: 1,
          evidenceIds: ['e1'],
          attributes: {},
          createdAt: '2026-09-30T08:00:00.000Z',
          updatedAt: '2026-09-30T08:00:00.000Z',
        },
      ],
    },
  };

  const view = buildGraphInspectorView(state);
  assert.equal(view.graphRevision, 7);
  assert.equal(view.evidenceCount, 1);
  assert.deepEqual(view.nodesByKind, [
    { key: 'content', count: 1 },
    { key: 'creator', count: 1 },
  ]);
  assert.deepEqual(view.edgesByRelation, [{ key: 'created_by', count: 1 }]);
  assert.equal(view.nodes.find((node) => node.id === 'creator:youtube:creator-a').supportCount, 1);
  assert.deepEqual(view.edges[0].evidence, [{
    id: 'e1',
    kind: 'interaction',
    interaction: 'watched',
    connector: 'youtube',
    mechanism: 'player_watch',
    observedAt: '2026-09-30T08:00:00.000Z',
    contentLabel: 'Video A',
  }]);
  assert.equal(view.revisions[0].revision, 7);
});

test('graph inspector parses exported JSON without mutating live state and rejects invalid snapshots', () => {
  const empty = {
    schemaVersion: 2,
    evidence: [],
    graph: { nodes: [], edges: [], userEdits: [], revisions: [], currentRevision: 0 },
  };
  assert.equal(parseGraphInspectorExport(JSON.stringify(empty)).nodeCount, 0);
  assert.throws(() => parseGraphInspectorExport('{'), /not valid JSON/);
  assert.throws(
    () => buildGraphInspectorView({ schemaVersion: 1, evidence: [], graph: {} }),
    /not a valid MyAlgo Personal Algorithm export/,
  );
});


test('graph mode overlay highlights exact mode members and their immediate graph neighbourhood', () => {
  const view = {
    schemaVersion: 2,
    graphRevision: 8,
    evidenceCount: 0,
    nodeCount: 4,
    edgeCount: 3,
    nodesByKind: [],
    edgesByRelation: [],
    revisions: [],
    nodes: [
      { id: 'concept:ai', label: 'AI', kind: 'concept', provenance: 'inferred', confidence: 1, supportCount: 2 },
      { id: 'topic:systems', label: 'Systems', kind: 'topic', provenance: 'inferred', confidence: 1, supportCount: 2 },
      { id: 'creator:a', label: 'Creator A', kind: 'creator', provenance: 'inferred', confidence: 1, supportCount: 1 },
      { id: 'content:a', label: 'Video A', kind: 'content', provenance: 'explicit', confidence: null, supportCount: 1 },
    ],
    edges: [
      {
        id: 'edge:ai-systems', relation: 'related_to', provenance: 'inferred', confidence: 1,
        sourceNodeId: 'concept:ai', sourceLabel: 'AI', targetNodeId: 'topic:systems', targetLabel: 'Systems',
        evidenceIds: [], evidence: [],
      },
      {
        id: 'edge:systems-creator', relation: 'influences', provenance: 'inferred', confidence: 1,
        sourceNodeId: 'topic:systems', sourceLabel: 'Systems', targetNodeId: 'creator:a', targetLabel: 'Creator A',
        evidenceIds: [], evidence: [],
      },
      {
        id: 'edge:creator-content', relation: 'created_by', provenance: 'inferred', confidence: 1,
        sourceNodeId: 'content:a', sourceLabel: 'Video A', targetNodeId: 'creator:a', targetLabel: 'Creator A',
        evidenceIds: [], evidence: [],
      },
    ],
  };
  const catalog = {
    pipelineId: 'durable-semantic-mode-cluster-v1',
    graphRevision: 8,
    generatedAt: '2026-09-30T09:00:00.000Z',
    modes: [{
      id: 'mode:systems',
      label: 'Systems mode',
      revision: 4,
      provenance: 'inferred',
      pipelineId: 'durable-semantic-mode-cluster-v1',
      graphRevision: 8,
      createdAt: '2026-09-30T08:00:00.000Z',
      lastSupportedAt: '2026-09-30T09:00:00.000Z',
      active: true,
      pinned: false,
      members: [{
        canonicalId: 'canonical:systems',
        label: 'Systems',
        weight: 1,
        sourceNodeIds: ['topic:systems'],
        supportContentIds: ['content:a'],
      }],
    }],
  };

  const overlay = buildGraphModeOverlay(view, catalog, 'mode:systems');
  assert.deepEqual(overlay.memberNodeIds, ['topic:systems']);
  assert.deepEqual(overlay.connectedNodeIds, ['concept:ai', 'creator:a', 'topic:systems']);
  assert.deepEqual(overlay.connectedEdgeIds, ['edge:ai-systems', 'edge:systems-creator']);
  assert.equal(overlay.modeRevision, 4);
});

test('graph mode overlay returns the full-graph sentinel without inventing membership', () => {
  const overlay = buildGraphModeOverlay({
    schemaVersion: 2,
    graphRevision: 0,
    evidenceCount: 0,
    nodeCount: 0,
    edgeCount: 0,
    nodesByKind: [],
    edgesByRelation: [],
    nodes: [],
    edges: [],
    revisions: [],
  }, null, 'all');

  assert.deepEqual(overlay, {
    modeId: 'all',
    modeLabel: 'All graph',
    modeRevision: null,
    memberNodeIds: [],
    connectedNodeIds: [],
    connectedEdgeIds: [],
  });
});
