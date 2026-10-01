import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDurableModeOptions, buildExplanationGraphView, buildGraphInspectorView, buildGraphModeOverlay, parseGraphInspectorExport, summarizeFeed } from './extension-helpers.ts';

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
          provenance: 'explicit', confidence: null,
          attributes: {
            metadata: {
              creatorName: 'Creator A',
              thumbnailUrl: 'https://i.ytimg.com/vi/video-a/mqdefault.jpg',
            },
          },
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
  const contentNode = view.nodes.find((node) => node.id === 'content:youtube:video-a');
  assert.equal(contentNode.thumbnailUrl, 'https://i.ytimg.com/vi/video-a/mqdefault.jpg');
  assert.equal(contentNode.creatorName, 'Creator A');
  assert.equal(contentNode.contentExternalId, 'video-a');
  assert.deepEqual(view.edges[0].evidence, [{
    id: 'e1',
    kind: 'interaction',
    interaction: 'watched',
    connector: 'youtube',
    mechanism: 'player_watch',
    observedAt: '2026-09-30T08:00:00.000Z',
    confidence: 1,
    contentLabel: 'Video A',
  }]);
  assert.equal(view.revisions[0].revision, 7);
});

test('graph inspector anchors retained content to durable catalog groups even without cached mode affinity', () => {
  const state = {
    schemaVersion: 3,
    evidence: [],
    forgottenEvidence: [],
    graph: {
      currentRevision: 4,
      userEdits: [],
      revisions: [],
      controls: [],
      nodes: [{
        id: 'content:youtube:video-a',
        kind: 'content',
        label: 'Video A',
        content: { source: 'youtube', externalId: 'video-a' },
        provenance: 'explicit',
        confidence: null,
        attributes: {},
        createdAt: '2026-10-01T08:00:00.000Z',
        updatedAt: '2026-10-01T08:00:00.000Z',
      }],
      edges: [],
    },
  };
  const catalog = {
    pipelineId: 'durable-semantic-mode-cluster-v1',
    graphRevision: 4,
    generatedAt: '2026-10-01T09:00:00.000Z',
    modes: [{
      id: 'mode:systems',
      label: 'Distributed systems',
      revision: 2,
      provenance: 'inferred',
      pipelineId: 'durable-semantic-mode-cluster-v1',
      graphRevision: 4,
      createdAt: '2026-10-01T08:30:00.000Z',
      lastSupportedAt: '2026-10-01T09:00:00.000Z',
      active: true,
      pinned: false,
      members: [{
        canonicalId: 'canonical:systems',
        label: 'Distributed systems',
        weight: 0.9,
        sourceNodeIds: ['concept:systems'],
        supportContentIds: ['content:youtube:video-a'],
      }],
    }],
  };

  const view = buildGraphInspectorView(state, [{
    externalId: 'video-a',
    category: 'Technology',
    categoryConfidence: 0.7,
    categoryScores: { Technology: 0.7 },
    graphMatches: [{ nodeId: 'concept:systems', nodeLabel: 'Systems', similarity: 0.75, taxonomyOnly: false }],
    modeAffinities: [],
  }], catalog);

  assert.equal(view.nodes[0].semanticClusterId, 'mode:mode:systems');
  assert.equal(view.nodes[0].semanticClusterLabel, 'Distributed systems');
  assert.equal(view.nodes[0].semanticClusterKind, 'mode');
  assert.equal(view.nodes[0].semanticClusterAffinity, 0.9);
});

test('graph inspector prefers durable groups and uses semantic topics only as a fallback', () => {
  const state = {
    schemaVersion: 2,
    evidence: [],
    graph: {
      currentRevision: 1,
      userEdits: [],
      revisions: [],
      nodes: [{
        id: 'content:youtube:video-a',
        kind: 'content',
        label: 'Video A',
        content: { source: 'youtube', externalId: 'video-a' },
        provenance: 'explicit',
        confidence: null,
        attributes: {},
        createdAt: '2026-09-30T08:00:00.000Z',
        updatedAt: '2026-09-30T08:00:00.000Z',
      }],
      edges: [],
    },
  };

  const durableGroupView = buildGraphInspectorView(state, [{
    externalId: 'video-a',
    category: 'AI tooling',
    categoryConfidence: 0.81,
    categoryScores: { 'AI tooling': 0.81, 'People & Blogs': 0.31 },
    graphMatches: [
      { nodeId: 'concept:agents', nodeLabel: 'AI agents', similarity: 0.72, taxonomyOnly: false },
      { nodeId: 'concept:generic', nodeLabel: 'Technology', similarity: 0.91, taxonomyOnly: true },
    ],
    modeAffinities: [{ modeId: 'mode:ai', label: 'AI work', affinity: 0.84 }],
  }]);
  assert.equal(durableGroupView.nodes[0].semanticClusterId, 'mode:mode:ai');
  assert.equal(durableGroupView.nodes[0].semanticClusterLabel, 'AI work');
  assert.equal(durableGroupView.nodes[0].semanticClusterKind, 'mode');
  assert.equal(durableGroupView.nodes[0].semanticClusterAffinity, 0.84);

  const graphMatchFallbackView = buildGraphInspectorView(state, [{
    externalId: 'video-a',
    category: 'AI tooling',
    categoryConfidence: 0.81,
    categoryScores: { 'AI tooling': 0.81, 'People & Blogs': 0.31 },
    graphMatches: [
      { nodeId: 'concept:agents', nodeLabel: 'AI agents', similarity: 0.72, taxonomyOnly: false },
    ],
    modeAffinities: [],
  }]);
  assert.equal(graphMatchFallbackView.nodes[0].semanticClusterId, 'topic:concept:agents');
  assert.equal(graphMatchFallbackView.nodes[0].semanticClusterLabel, 'AI agents');
  assert.equal(graphMatchFallbackView.nodes[0].semanticClusterKind, 'topic');
  assert.equal(graphMatchFallbackView.nodes[0].semanticClusterAffinity, 0.72);

  const categoryFallbackView = buildGraphInspectorView(state, [{
    externalId: 'video-a',
    category: 'AI tooling',
    categoryConfidence: 0.44,
    categoryScores: { 'AI tooling': 0.44, 'People & Blogs': 0.29 },
    graphMatches: [],
    modeAffinities: [],
  }]);
  assert.equal(categoryFallbackView.nodes[0].semanticClusterId, 'topic:ai tooling');
  assert.equal(categoryFallbackView.nodes[0].semanticClusterLabel, 'AI tooling');
  assert.equal(categoryFallbackView.nodes[0].semanticClusterKind, 'topic');
  assert.equal(categoryFallbackView.nodes[0].semanticClusterAffinity, 0.44);
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


test('explanation graph view contains only exact trace nodes and stored connecting edges', () => {
  const view = {
    schemaVersion: 2,
    graphRevision: 12,
    evidenceCount: 2,
    nodeCount: 4,
    edgeCount: 3,
    nodesByKind: [],
    edgesByRelation: [],
    revisions: [],
    nodes: [
      { id: 'content:a', label: 'Video A', kind: 'content', provenance: 'explicit', confidence: null, supportCount: 1, contentSource: 'youtube', contentExternalId: 'a', creatorName: 'Creator A', thumbnailUrl: null },
      { id: 'creator:a', label: 'Creator A', kind: 'creator', provenance: 'inferred', confidence: 1, supportCount: 1, contentSource: null, contentExternalId: null, creatorName: null, thumbnailUrl: null },
      { id: 'topic:systems', label: 'Systems', kind: 'topic', provenance: 'inferred', confidence: 1, supportCount: 2, contentSource: null, contentExternalId: null, creatorName: null, thumbnailUrl: null },
      { id: 'topic:music', label: 'Music', kind: 'topic', provenance: 'inferred', confidence: 1, supportCount: 2, contentSource: null, contentExternalId: null, creatorName: null, thumbnailUrl: null },
    ],
    edges: [
      { id: 'edge:created', relation: 'created_by', provenance: 'inferred', confidence: 1, sourceNodeId: 'content:a', sourceLabel: 'Video A', targetNodeId: 'creator:a', targetLabel: 'Creator A', evidenceIds: ['e1'], evidence: [] },
      { id: 'edge:systems', relation: 'related_to', provenance: 'inferred', confidence: 1, sourceNodeId: 'creator:a', sourceLabel: 'Creator A', targetNodeId: 'topic:systems', targetLabel: 'Systems', evidenceIds: ['e2'], evidence: [] },
      { id: 'edge:music', relation: 'related_to', provenance: 'inferred', confidence: 1, sourceNodeId: 'creator:a', sourceLabel: 'Creator A', targetNodeId: 'topic:music', targetLabel: 'Music', evidenceIds: [], evidence: [] },
    ],
  };

  const explanation = {
    rawScore: 17,
    displayScore: 76,
    graphRevision: 12,
    policyRevision: 'policy-v1',
    acquisitionMechanism: 'observed_dom',
    contributions: [
      { label: 'Systems', value: 8, kind: 'node', sourceId: 'topic:systems', evidenceIds: ['e2'] },
    ],
    matchedPaths: [
      { nodeIds: ['creator:a', 'topic:systems'], nodeLabels: ['Creator A', 'Systems'], edgeIds: ['edge:systems'], evidenceIds: ['e2'] },
    ],
    modeGrounding: null,
  };

  const subgraph = buildExplanationGraphView(view, 'content:a', explanation);
  assert.deepEqual(
    subgraph.nodes.map((node) => node.id).sort(),
    ['content:a', 'creator:a', 'topic:systems'],
  );
  assert.deepEqual(
    subgraph.edges.map((edge) => edge.id).sort(),
    ['edge:created', 'edge:systems'],
  );
  assert.equal(subgraph.edges.some((edge) => edge.id === 'edge:music'), false);
});


test('graph inspector exposes muted controls with human target labels', () => {
  const state = {
    schemaVersion: 2,
    evidence: [],
    graph: {
      currentRevision: 4,
      userEdits: [],
      revisions: [],
      controls: [{
        id: 'control:node:topic-ai',
        targetKind: 'node',
        targetId: 'topic:ai',
        action: 'mute',
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      }],
      nodes: [{
        id: 'topic:ai',
        kind: 'topic',
        label: 'AI takeover',
        content: null,
        provenance: 'inferred',
        confidence: 0.9,
        attributes: {},
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-01T09:00:00.000Z',
      }],
      edges: [],
    },
  };

  const view = buildGraphInspectorView(state);
  assert.equal(view.controls.length, 1);
  assert.deepEqual(view.controls[0], {
    id: 'control:node:topic-ai',
    targetKind: 'node',
    targetId: 'topic:ai',
    targetLabel: 'AI takeover',
    action: 'mute',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  });
});
