import test from 'node:test';
import assert from 'node:assert/strict';

const backing = new Map();
let setCalls = 0;

const storage = {
  async get(keys) {
    return Object.fromEntries(keys
      .filter((key) => backing.has(key))
      .map((key) => [key, backing.get(key)]));
  },
  async set(values) {
    setCalls += 1;
    Object.entries(values).forEach(([key, value]) => backing.set(key, value));
  },
  async remove(keys) {
    keys.forEach((key) => backing.delete(key));
  },
};

const { LocalPersonalAlgorithmStore } = await import('./personal-algorithm-store.ts');
const { scorePersonalAlgorithm } = await import('@repo/recommender-core');

const exposure = {
  kind: 'exposure',
  exposureId: 'yt-1|home||0',
  content: { source: 'youtube', externalId: 'yt-1' },
  surface: 'home',
  section: null,
  position: 0,
  observedAt: '2026-09-25T10:00:00.000Z',
  provenance: { connector: 'youtube', mechanism: 'home_dom' },
  metadata: { title: 'Test video' },
};



test('incremental evidence ingestion materializes creator nodes and created_by edges', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: {
      ...exposure,
      metadata: { title: 'Creator video', creatorId: 'creator-1', creatorName: 'Creator One' },
    },
  }, 'creator-evidence-1');

  const graph = await store.getGraph();
  const creator = graph.nodes.find((node) => node.kind === 'creator');
  const edge = graph.edges.find((item) => item.relation === 'created_by');

  assert.equal(creator?.id, 'creator:youtube:creator-1');
  assert.equal(edge?.sourceNodeId, 'content:youtube:yt-1');
  assert.equal(edge?.targetNodeId, 'creator:youtube:creator-1');
  assert.deepEqual(edge?.evidenceIds, ['creator-evidence-1']);
});

test('incremental evidence ingestion merges supporting evidence without duplicating creator edges', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: {
      ...exposure,
      metadata: { title: 'Creator video', creatorName: 'Creator One' },
    },
  }, 'creator-evidence-1');
  await store.upsertEvidence({
    evidence: {
      ...exposure,
      exposureId: 'yt-1|home||1',
      metadata: { title: 'Creator video', creatorName: 'Creator One' },
    },
  }, 'creator-evidence-2');

  const graph = await store.getGraph();
  const edges = graph.edges.filter((item) => item.relation === 'created_by');
  assert.equal(edges.length, 1);
  assert.deepEqual(edges[0].evidenceIds, ['creator-evidence-1', 'creator-evidence-2']);
});

test('incremental evidence ingestion does not invent creator relationships without creator metadata', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({ evidence: exposure }, 'no-creator-evidence');

  const graph = await store.getGraph();
  assert.equal(graph.nodes.filter((node) => node.kind === 'creator').length, 0);
  assert.equal(graph.edges.filter((edge) => edge.relation === 'created_by').length, 0);
});



test('replacing evidence reconciles stale creator relationship support', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: {
      ...exposure,
      metadata: { title: 'Creator video', creatorName: 'Old Creator' },
    },
  }, 'replace-creator');
  assert.equal((await store.getGraph()).edges.length, 1);

  await store.upsertEvidence({
    evidence: {
      ...exposure,
      metadata: { title: 'Creator video', creatorName: 'New Creator' },
    },
  }, 'replace-creator');

  const graph = await store.getGraph();
  const creatorEdges = graph.edges.filter((edge) => edge.relation === 'created_by');
  assert.equal(creatorEdges.length, 1);
  assert.equal(creatorEdges[0].targetNodeId, 'creator:youtube:New%20Creator');
  assert.deepEqual(creatorEdges[0].evidenceIds, ['replace-creator']);
  assert.equal(graph.edges.some((edge) => edge.targetNodeId === 'creator:youtube:Old%20Creator'), false);
  assert.equal(graph.nodes.some((node) => node.id === 'creator:youtube:Old%20Creator'), false);
});

test('incremental creator relationships remain evidence-backed after metadata arrives later', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: { ...exposure, metadata: { title: 'Initially bare' } },
  }, 'late-creator-1');
  assert.equal((await store.getGraph()).edges.length, 0);

  await store.upsertEvidence({
    evidence: {
      ...exposure,
      exposureId: 'yt-1|home||1',
      metadata: { title: 'Hydrated', creatorId: 'creator-late', creatorName: 'Late Creator' },
    },
  }, 'late-creator-2');

  const graph = await store.getGraph();
  const edge = graph.edges.find((item) => item.relation === 'created_by');
  assert.equal(edge?.targetNodeId, 'creator:youtube:creator-late');
  assert.deepEqual(edge?.evidenceIds, ['late-creator-2']);
});

test('schema v2 migrates to v3 with an empty forgotten-evidence ledger', async () => {
  backing.clear();
  backing.set('personal-algorithm-state', {
    schemaVersion: 2,
    evidence: [],
    graph: {
      nodes: [],
      edges: [],
      userEdits: [],
      revisions: [],
      currentRevision: 0,
      controls: [],
      originalBaseline: null,
    },
  });

  const store = new LocalPersonalAlgorithmStore(storage);
  const migrated = await store.exportState();

  assert.equal(migrated.schemaVersion, 3);
  assert.deepEqual(migrated.forgottenEvidence, []);
  assert.deepEqual(migrated.graph.controls, []);
});

test('local store persists normalized evidence and graph content nodes across restart', async () => {
  backing.clear();
  setCalls = 0;
  const first = new LocalPersonalAlgorithmStore(storage);
  const record = await first.upsertEvidence({
    evidence: exposure,
    confidence: 1.2,
    retentionPolicy: 'until_expiry',
    expiresAt: '2026-10-25T10:00:00.000Z',
  }, 'evidence-1');

  assert.equal(record.confidence, 1);
  assert.equal((await first.listEvidence()).length, 1);
  assert.equal((await first.getGraph()).nodes[0].id, 'content:youtube:yt-1');

  const restarted = new LocalPersonalAlgorithmStore(storage);
  const persisted = await restarted.getEvidence('evidence-1');
  assert.equal(persisted?.retention.policy, 'until_expiry');
  assert.equal((await restarted.getGraph()).nodes[0].label, 'Test video');
});

test('history reconciliation replaces legacy history evidence in one storage write', async () => {
  backing.clear();
  setCalls = 0;
  const store = new LocalPersonalAlgorithmStore(storage);

  const historyEvidence = (id, title) => ({
    kind: 'interaction',
    content: { source: 'youtube', externalId: id },
    exposureId: null,
    interaction: 'watched',
    observedAt: '2026-09-25T10:00:00.000Z',
    provenance: { connector: 'youtube', mechanism: 'history_dom' },
    metadata: { title, creatorName: 'History creator' },
  });

  await store.upsertEvidence({ evidence: historyEvidence('legacy-1', 'Legacy 1') }, 'interaction:watched:legacy-1:2026-09-25T10:00:00.000Z');
  await store.upsertEvidence({ evidence: historyEvidence('legacy-2', 'Legacy 2') }, 'interaction:watched:legacy-2:2026-09-25T10:01:00.000Z');
  const writesBeforeReconcile = setCalls;

  const result = await store.reconcileHistoryEvidence([
    { id: 'interaction:watched:legacy-1:history', evidence: historyEvidence('legacy-1', 'Canonical 1') },
    { id: 'interaction:watched:legacy-2:history', evidence: historyEvidence('legacy-2', 'Canonical 2') },
  ]);

  assert.deepEqual(result, { removed: 2, upserted: 2 });
  assert.equal(setCalls, writesBeforeReconcile + 1);
  assert.deepEqual(
    (await store.listEvidence()).map((record) => record.id).sort(),
    [
      'interaction:watched:legacy-1:history',
      'interaction:watched:legacy-2:history',
    ],
  );
  assert.equal((await store.getGraph()).nodes.length, 3);
  assert.equal((await store.getGraph()).nodes.filter((node) => node.kind === 'creator').length, 1);
});


test('history reconciliation preserves unrelated evidence and is stable across repeated scans', async () => {
  backing.clear();
  setCalls = 0;
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({ evidence: exposure }, 'unrelated-exposure');

  const historyEvidence = (videoId, title, creatorName = 'History creator') => ({
    kind: 'interaction',
    content: { source: 'youtube', externalId: videoId },
    exposureId: null,
    interaction: 'watched',
    observedAt: '2026-09-25T10:00:00.000Z',
    provenance: { connector: 'youtube', mechanism: 'history_dom' },
    metadata: { title, creatorName },
  });

  const inputs = [
    { id: 'interaction:watched:history-a:history', evidence: historyEvidence('history-a', 'History A') },
    { id: 'interaction:watched:history-b:history', evidence: historyEvidence('history-b', 'History B') },
  ];

  await store.reconcileHistoryEvidence(inputs);
  const first = await store.listEvidence();
  assert.deepEqual(first.map((record) => record.id).sort(), [
    'interaction:watched:history-a:history',
    'interaction:watched:history-b:history',
    'unrelated-exposure',
  ]);

  await store.reconcileHistoryEvidence([
    { ...inputs[0], evidence: historyEvidence('history-a', 'History A refreshed', 'Refreshed creator') },
    inputs[1],
  ]);

  const second = await store.listEvidence();
  assert.deepEqual(second.map((record) => record.id).sort(), [
    'interaction:watched:history-a:history',
    'interaction:watched:history-b:history',
    'unrelated-exposure',
  ]);
  const refreshed = await store.getEvidence('interaction:watched:history-a:history');
  assert.equal(refreshed?.evidence.metadata?.title, 'History A refreshed');
  assert.equal(refreshed?.evidence.metadata?.creatorName, 'Refreshed creator');
  assert.equal((await store.getGraph()).nodes.filter((node) => node.kind === 'content').length, 3);
});

test('history reconciliation removes unsupported inferred edges when legacy history records are replaced', async () => {
  backing.clear();
  setCalls = 0;
  const store = new LocalPersonalAlgorithmStore(storage);

  const historyEvidence = (videoId, title) => ({
    kind: 'interaction',
    content: { source: 'youtube', externalId: videoId },
    exposureId: null,
    interaction: 'watched',
    observedAt: '2026-09-25T10:00:00.000Z',
    provenance: { connector: 'youtube', mechanism: 'history_dom' },
    metadata: { title, creatorName: 'History creator' },
  });

  await store.upsertEvidence({ evidence: historyEvidence('legacy-video', 'Legacy video') }, 'legacy-history');
  await store.upsertEdge({
    id: 'legacy-history-edge',
    sourceNodeId: 'content:youtube:legacy-video',
    targetNodeId: 'creator:history-creator',
    relation: 'created_by',
    provenance: 'inferred',
    confidence: 1,
    evidenceIds: ['legacy-history'],
    attributes: {},
  });

  await store.reconcileHistoryEvidence([
    { id: 'interaction:watched:canonical-video:history', evidence: historyEvidence('canonical-video', 'Canonical video') },
  ]);

  assert.equal(await store.getEvidence('legacy-history'), null);
  assert.equal(await store.getEvidence('interaction:watched:canonical-video:history') !== null, true);
  assert.equal((await store.getGraph()).edges.some((edge) => edge.id === 'legacy-history-edge'), false);
  assert.equal((await store.getGraph()).nodes.some((node) => node.id === 'content:youtube:canonical-video'), true);
});

test('local store supports evidence CRUD, targeted deletion, graph edits, revisions, and export', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);
  const second = await store.upsertEvidence({
    evidence: {
      ...exposure,
      exposureId: 'reddit-1|home||0',
      content: { source: 'reddit', externalId: 'same-id' },
    },
  }, 'evidence-2');

  const supporting = await store.upsertEvidence({
    evidence: {
      ...exposure,
      content: { source: 'youtube', externalId: 'yt-1' },
    },
  }, 'evidence-3');

  assert.equal((await store.deleteEvidence(second.id)), true);
  assert.equal(await store.getEvidence(second.id), null);

  const node = await store.upsertNode({
    id: 'topic:testing',
    kind: 'topic',
    label: 'Testing',
    provenance: 'explicit',
    confidence: 1,
    attributes: {},
  });
  const edge = await store.upsertEdge({
    id: 'edge-1',
    sourceNodeId: node.id,
    targetNodeId: 'content:youtube:yt-1',
    relation: 'about',
    provenance: 'inferred',
    confidence: 0.8,
    evidenceIds: [supporting.id],
    attributes: {},
  });

  assert.deepEqual(edge.evidenceIds, [supporting.id]);
  assert.deepEqual(await store.getEvidenceForEdge('edge-1'), [supporting]);

  const graph = await store.getGraph();
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.currentRevision, 3);
  assert.equal(graph.userEdits.length, 2);
  assert.equal(graph.revisions.length, 3);
  assert.equal(graph.revisions.at(-1).reason.startsWith('create_edge:'), true);

  assert.equal((await store.deleteEvidence('evidence-3')), true);
  assert.equal((await store.getGraph()).edges.length, 0);
  assert.deepEqual(await store.getEvidenceForEdge('edge-1'), []);

  await assert.rejects(
    store.upsertEdge({
      id: 'edge-invalid',
      sourceNodeId: node.id,
      targetNodeId: 'content:youtube:yt-1',
      relation: 'about',
      provenance: 'inferred',
      confidence: 0.5,
      evidenceIds: [],
      attributes: {},
    }),
    /supporting evidence/,
  );

  const exported = await store.exportState();
  const exportedJson = await store.exportStateJson();
  assert.equal(JSON.parse(exportedJson).schemaVersion, 3);
  assert.equal(exported.schemaVersion, 3);
  assert.equal(exported.graph.nodes.some((item) => item.id === 'topic:testing'), true);

  await store.reset();
  assert.deepEqual(await store.listEvidence(), []);
  assert.equal((await store.getGraph()).currentRevision, 0);
});

test('Forget tombstones evidence so reconciliation, rebuild, undo, and restore cannot recreate it', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);
  const evidenceId = 'interaction:watched:forgotten-video:history';
  const forgottenEvidence = {
    kind: 'interaction',
    content: { source: 'youtube', externalId: 'forgotten-video' },
    exposureId: null,
    interaction: 'watched',
    observedAt: '2026-10-01T18:00:00.000Z',
    provenance: { connector: 'youtube', mechanism: 'history_dom' },
    metadata: { title: 'Forgotten video', creatorId: 'creator-forgotten', creatorName: 'Forgotten Creator' },
  };

  await store.upsertEvidence({ evidence: forgottenEvidence }, evidenceId);
  const creatorId = 'creator:youtube:creator-forgotten';
  await store.setGraphControl('node', creatorId, 'reduce');
  const revisionBeforeForget = (await store.getGraph()).currentRevision;

  const result = await store.forgetEvidence(evidenceId);
  assert.equal(result.forgotten, true);
  assert.equal(result.graphRevision, revisionBeforeForget + 1);
  assert.equal(await store.getEvidence(evidenceId), null);

  const afterForget = await store.exportState();
  assert.deepEqual(afterForget.forgottenEvidence.map((entry) => entry.evidenceId), [evidenceId]);
  assert.equal(afterForget.graph.edges.some((edge) => edge.evidenceIds.includes(evidenceId)), false);

  const reingested = await store.upsertEvidence({ evidence: forgottenEvidence }, evidenceId);
  assert.equal(reingested, null);
  const reconciled = await store.reconcileHistoryEvidence([
    { id: evidenceId, evidence: forgottenEvidence },
  ]);
  assert.equal(reconciled.upserted, 0);

  await store.rebuildGraphFromEvidence();
  assert.equal(await store.getEvidence(evidenceId), null);
  assert.equal((await store.getGraph()).edges.some((edge) => edge.evidenceIds.includes(evidenceId)), false);

  await store.restoreOriginalGraph();
  assert.equal(await store.getEvidence(evidenceId), null);
  assert.equal((await store.getGraph()).edges.some((edge) => edge.evidenceIds.includes(evidenceId)), false);

  await store.undoLastGraphEdit();
  assert.equal(await store.getEvidence(evidenceId), null);
  assert.equal((await store.getGraph()).edges.some((edge) => edge.evidenceIds.includes(evidenceId)), false);

  const restarted = new LocalPersonalAlgorithmStore(storage);
  assert.equal(await restarted.getEvidence(evidenceId), null);
  assert.deepEqual(
    (await restarted.exportState()).forgottenEvidence.map((entry) => entry.evidenceId),
    [evidenceId],
  );

  await restarted.reset();
  const resetState = await restarted.exportState();
  assert.deepEqual(resetState.evidence, []);
  assert.deepEqual(resetState.forgottenEvidence, []);
  assert.equal(resetState.graph.currentRevision, 0);
});

test('Forget changes scoring when deleted evidence was the sole support for a score-bearing path', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);
  const evidenceId = 'interaction:watched:score-video:history';
  await store.upsertEvidence({
    evidence: {
      kind: 'interaction',
      content: { source: 'youtube', externalId: 'score-video' },
      exposureId: null,
      interaction: 'watched',
      observedAt: '2026-10-01T18:10:00.000Z',
      provenance: { connector: 'youtube', mechanism: 'history_dom' },
      metadata: { title: 'Scored video', creatorId: 'score-creator', creatorName: 'Score Creator' },
    },
  }, evidenceId);

  const candidate = {
    id: 'score-candidate',
    content: { source: 'youtube', externalId: 'score-video' },
    nodeIds: ['content:youtube:score-video'],
    creatorNodeId: 'creator:youtube:score-creator',
  };
  const policy = {
    revision: 'forget-score-test',
    baseScore: 1,
    nodeWeights: {
      'content:youtube:score-video': 2,
      'creator:youtube:score-creator': 3,
    },
    edgeRelationWeights: { created_by: 4 },
  };

  const before = scorePersonalAlgorithm(await store.exportState(), candidate, policy);
  assert.equal(before.score, 10);

  await store.forgetEvidence(evidenceId);
  const afterState = await store.exportState();
  const after = scorePersonalAlgorithm(afterState, candidate, policy);
  assert.equal(after.score, 1);
  assert.equal(afterState.graph.edges.some((edge) => edge.evidenceIds.includes(evidenceId)), false);
  assert.equal(afterState.graph.nodes.some((node) => node.id === 'creator:youtube:score-creator'), false);
});

test('rebuildGraphFromEvidence materializes deterministic creator nodes and evidence-backed edges', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);
  await store.upsertEvidence({
    evidence: {
      ...exposure,
      metadata: { title: 'Video A', creatorId: 'creator-1', creatorName: 'Creator One' },
    },
  }, 'evidence-a');
  await store.upsertEvidence({
    evidence: {
      ...exposure,
      exposureId: 'yt-2|home||1',
      content: { source: 'youtube', externalId: 'yt-2' },
      metadata: { title: 'Video B', creatorId: 'creator-1', creatorName: 'Creator One' },
    },
  }, 'evidence-b');

  const first = await store.rebuildGraphFromEvidence();
  const second = await store.rebuildGraphFromEvidence();
  assert.deepEqual(second.nodes.map((node) => [node.id, node.kind]).sort(), first.nodes.map((node) => [node.id, node.kind]).sort());

  const creatorEdges = second.edges.filter((edge) => edge.relation === 'created_by');
  assert.equal(creatorEdges.length, 2);
  assert.deepEqual(
    creatorEdges.map((edge) => edge.evidenceIds).sort(),
    [['evidence-a'], ['evidence-b']],
  );

  const review = await store.reviewGraph();
  assert.equal(review.inferredEdgeCount, 2);
  assert.equal(review.inferredEdgesWithSupport, 2);
  assert.equal(review.inferredEdgesWithoutSupport, 0);
  assert.equal(review.edgesByRelation.created_by, 2);
  assert.equal(review.nodesByKind.creator, 1);

  await store.deleteEvidence('evidence-a');
  const afterDelete = await store.reviewGraph();
  assert.equal(afterDelete.inferredEdgeCount, 1);
  assert.deepEqual(afterDelete.unsupportedEdgeIds, []);
});


test('content nodes preserve and hydrate normalized metadata without creating semantic topic nodes', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: {
      ...exposure,
      metadata: {
        title: 'Metadata title',
        description: 'Description',
        durationSeconds: 120,
        creatorName: 'Creator One',
      },
    },
  }, 'metadata-1');

  const first = (await store.getGraph()).nodes[0];
  assert.equal(first.label, 'Metadata title');
  assert.deepEqual(first.attributes.metadata, {
    title: 'Metadata title',
    description: 'Description',
    durationSeconds: 120,
    creatorName: 'Creator One',
  });

  await store.upsertEvidence({
    evidence: {
      ...exposure,
      exposureId: 'yt-1|home||1',
      metadata: {
        title: 'Metadata title',
        creatorId: 'creator-1',
        creatorName: 'Creator One',
        publishedAt: '2026-09-25T09:00:00.000Z',
      },
    },
  }, 'metadata-2');

  const graph = await store.getGraph();
  assert.equal(graph.nodes.filter((node) => node.kind === 'content').length, 1);
  assert.equal(graph.nodes.filter((node) => node.kind === 'topic').length, 0);
  assert.equal(graph.nodes.find((node) => node.kind === 'content')?.label, 'Metadata title');
  assert.equal(graph.nodes[0].attributes.metadata.creatorId, 'creator-1');
  assert.equal(graph.nodes[0].attributes.metadata.description, 'Description');
  assert.equal(graph.nodes[0].attributes.metadata.publishedAt, '2026-09-25T09:00:00.000Z');
});

test('rebuild hydrates content labels and metadata from exposure evidence', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: {
      ...exposure,
      metadata: undefined,
    },
  }, 'bare');
  await store.upsertEvidence({
    evidence: {
      ...exposure,
      exposureId: 'yt-1|home||1',
      observedAt: '2026-09-25T10:01:00.000Z',
      metadata: {
        title: 'Recovered title',
        creatorName: 'Recovered creator',
        contentType: 'video',
      },
    },
  }, 'hydrated');

  const graph = await store.rebuildGraphFromEvidence();
  const content = graph.nodes.find((node) => node.id === 'content:youtube:yt-1');
  assert.equal(content?.label, 'Recovered title');
  assert.deepEqual(content?.attributes.metadata, {
    title: 'Recovered title',
    creatorName: 'Recovered creator',
    contentType: 'video',
  });
});

test('history interaction metadata hydrates content nodes and creator relationships', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: {
      kind: 'interaction',
      content: { source: 'youtube', externalId: 'history-1' },
      exposureId: null,
      interaction: 'watched',
      observedAt: '2026-09-25T10:00:00.000Z',
      provenance: { connector: 'youtube', mechanism: 'history_dom' },
      metadata: {
        title: 'History title',
        creatorName: 'History creator',
      },
    },
  }, 'history-1');

  const graph = await store.rebuildGraphFromEvidence();
  const content = graph.nodes.find((node) => node.id === 'content:youtube:history-1');
  assert.equal(content?.label, 'History title');
  assert.equal(content?.attributes.metadata.creatorName, 'History creator');

  const edge = graph.edges.find((item) => item.relation === 'created_by');
  assert.equal(edge?.sourceNodeId, 'content:youtube:history-1');
  assert.equal(edge?.evidenceIds.includes('history-1'), true);
});

test('legacy schema v1 migrates to v3 without discarding evidence or nodes', async () => {
  backing.clear();
  backing.set('personal-algorithm-state', {
    schemaVersion: 1,
    evidence: [{
      id: 'legacy-evidence',
      evidence: exposure,
      confidence: 1,
      retainedAt: '2026-09-25T10:00:00.000Z',
      retention: { policy: 'default', expiresAt: null },
    }],
    graph: {
      nodes: [{
        id: 'content:youtube:yt-1',
        kind: 'content',
        label: 'Test video',
        content: exposure.content,
        provenance: 'explicit',
        confidence: null,
        attributes: {},
        createdAt: '2026-09-25T10:00:00.000Z',
        updatedAt: '2026-09-25T10:00:00.000Z',
      }],
      edges: [{
        id: 'legacy-edge',
        sourceNodeId: 'topic:testing',
        targetNodeId: 'content:youtube:yt-1',
        relation: 'about',
        provenance: 'explicit',
        confidence: null,
        attributes: {},
        createdAt: '2026-09-25T10:00:00.000Z',
        updatedAt: '2026-09-25T10:00:00.000Z',
      }],
      userEdits: [],
      revisions: [],
      currentRevision: 0,
    },
  });

  const store = new LocalPersonalAlgorithmStore(storage);
  const state = await store.exportState();
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.evidence.length, 1);
  assert.deepEqual(state.forgottenEvidence, []);
  assert.deepEqual(state.graph.edges[0].evidenceIds, []);
  assert.equal(backing.get('personal-algorithm-state').schemaVersion, 3);
});

test('invalid or unknown schema versions migrate to a safe empty v3 state', async () => {
  backing.clear();
  backing.set('personal-algorithm-state', {
    schemaVersion: 99,
    evidence: [{ corrupt: true }],
    graph: { nodes: [], edges: [], userEdits: [], revisions: [], currentRevision: 1 },
  });

  const store = new LocalPersonalAlgorithmStore(storage);
  const state = await store.exportState();
  assert.equal(state.schemaVersion, 3);
  assert.deepEqual(state.evidence, []);
  assert.deepEqual(state.forgottenEvidence, []);
  assert.equal(state.graph.currentRevision, 0);
});


test('home exposure reconciliation keeps only the retained observation window', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  const makeExposure = (id) => ({
    ...exposure,
    exposureId: `${id}|home||0`,
    content: { source: 'youtube', externalId: id },
    metadata: { title: `Video ${id}` },
  });

  await store.reconcileExposureEvidence([
    { id: 'exposure:a', evidence: makeExposure('a') },
    { id: 'exposure:b', evidence: makeExposure('b') },
  ]);
  await store.reconcileExposureEvidence([
    { id: 'exposure:b', evidence: makeExposure('b') },
    { id: 'exposure:c', evidence: makeExposure('c') },
  ]);

  assert.deepEqual(
    (await store.listEvidence()).map((record) => record.id).sort(),
    ['exposure:b', 'exposure:c'],
  );
});

test('evidence compaction bounds default evidence while preserving indefinite evidence', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  for (let index = 0; index < 5; index += 1) {
    await store.upsertEvidence({
      evidence: {
        ...exposure,
        exposureId: `video-${index}|home||0`,
        content: { source: 'youtube', externalId: `video-${index}` },
        observedAt: `2026-09-25T10:0${index}:00.000Z`,
        metadata: { title: `Video ${index}` },
      },
    }, `default-${index}`);
  }
  await store.upsertEvidence({
    evidence: {
      ...exposure,
      exposureId: 'pinned|home||0',
      content: { source: 'youtube', externalId: 'pinned' },
      metadata: { title: 'Pinned' },
    },
    retentionPolicy: 'indefinite',
  }, 'pinned');

  const removed = await store.compactEvidence(2, new Date('2026-09-26T00:00:00.000Z'));
  const retained = await store.listEvidence();

  assert.equal(removed, 3);
  assert.equal(retained.filter((record) => record.retention.policy === 'default').length, 2);
  assert.equal(retained.some((record) => record.id === 'pinned'), true);
});


test('derived graph projection increments revision once and does not create synthetic user edits', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: {
      kind: 'interaction',
      content: { source: 'youtube', externalId: 'semantic-1' },
      exposureId: null,
      interaction: 'watched',
      observedAt: '2026-09-27T10:00:00.000Z',
      provenance: { connector: 'youtube', mechanism: 'history_dom' },
      metadata: { title: 'Distributed systems tutorial' },
    },
    confidence: 1,
  }, 'semantic-evidence-1');

  const projection = {
    marker: 'semantic-concept-materializer-v1',
    nodes: [{
      id: 'topic:derived:distributed%20systems',
      kind: 'topic',
      label: 'Distributed systems',
      content: null,
      provenance: 'inferred',
      confidence: 0.66,
      attributes: {
        derivedBy: 'semantic-concept-materializer-v1',
        rebuildable: true,
      },
    }],
    edges: [{
      id: 'edge:derived-about:test',
      sourceNodeId: 'topic:derived:distributed%20systems',
      targetNodeId: 'content:youtube:semantic-1',
      relation: 'about',
      provenance: 'inferred',
      confidence: 0.66,
      evidenceIds: ['semantic-evidence-1'],
      attributes: {
        derivedBy: 'semantic-concept-materializer-v1',
        rebuildable: true,
      },
    }],
  };

  const before = await store.exportState();
  const first = await store.reconcileDerivedGraphProjection(projection);
  const afterFirst = await store.exportState();
  const second = await store.reconcileDerivedGraphProjection(projection);
  const afterSecond = await store.exportState();

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(afterFirst.graph.currentRevision, before.graph.currentRevision + 1);
  assert.equal(afterSecond.graph.currentRevision, afterFirst.graph.currentRevision);
  assert.equal(afterFirst.graph.userEdits.length, before.graph.userEdits.length);
  assert.equal(
    afterFirst.graph.revisions.at(-1)?.reason,
    'derived_graph_reconcile:semantic-concept-materializer-v1',
  );
  assert.equal(
    afterSecond.graph.nodes.some((node) => node.id === 'topic:derived:distributed%20systems'),
    true,
  );
});

test('derived graph projection removes only owned derived structure and preserves explicit nodes', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: {
      kind: 'interaction',
      content: { source: 'youtube', externalId: 'semantic-2' },
      exposureId: null,
      interaction: 'watched',
      observedAt: '2026-09-27T10:00:00.000Z',
      provenance: { connector: 'youtube', mechanism: 'history_dom' },
      metadata: { title: 'Local AI tooling guide' },
    },
  }, 'semantic-evidence-2');

  await store.upsertNode({
    id: 'topic:explicit:local-ai',
    kind: 'topic',
    label: 'Local AI',
    provenance: 'explicit',
    confidence: 1,
    attributes: {},
  });

  await store.reconcileDerivedGraphProjection({
    marker: 'semantic-concept-materializer-v1',
    nodes: [{
      id: 'topic:derived:local%20llm',
      kind: 'topic',
      label: 'Local LLM',
      content: null,
      provenance: 'inferred',
      confidence: 0.7,
      attributes: { derivedBy: 'semantic-concept-materializer-v1', rebuildable: true },
    }],
    edges: [{
      id: 'edge:derived-about:local-llm',
      sourceNodeId: 'topic:derived:local%20llm',
      targetNodeId: 'content:youtube:semantic-2',
      relation: 'about',
      provenance: 'inferred',
      confidence: 0.7,
      evidenceIds: ['semantic-evidence-2'],
      attributes: { derivedBy: 'semantic-concept-materializer-v1', rebuildable: true },
    }],
  });

  const cleared = await store.reconcileDerivedGraphProjection({
    marker: 'semantic-concept-materializer-v1',
    nodes: [],
    edges: [],
  });
  const graph = await store.getGraph();

  assert.equal(cleared.changed, true);
  assert.equal(graph.nodes.some((node) => node.id === 'topic:derived:local%20llm'), false);
  assert.equal(graph.edges.some((edge) => edge.id === 'edge:derived-about:local-llm'), false);
  assert.equal(graph.nodes.some((node) => node.id === 'topic:explicit:local-ai'), true);
});


test('read snapshots are reused until store mutation and invalidated afterward', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  const first = await store.exportStateForRead();
  const second = await store.exportStateForRead();
  assert.equal(first, second);

  await store.upsertEvidence({ evidence: exposure }, 'snapshot-evidence');

  const third = await store.exportStateForRead();
  assert.notEqual(third, first);
  assert.equal(third.evidence.length, 1);
  assert.equal(await store.exportStateForRead(), third);

  const exported = await store.exportState();
  assert.notEqual(exported, third);
  assert.deepEqual(exported, third);
});


test('graph controls preserve a pre-edit baseline and support undo and restore without deleting evidence', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: {
      ...exposure,
      metadata: {
        title: 'Control target video',
        creatorId: 'creator-control',
        creatorName: 'Control Creator',
      },
    },
  }, 'control-evidence');

  const before = await store.exportState();
  const creatorId = before.graph.nodes.find((node) => node.kind === 'creator')?.id;
  assert.ok(creatorId);
  assert.equal(before.graph.currentRevision, 0);
  assert.equal(before.graph.originalBaseline ?? null, null);

  const reduced = await store.setGraphControl('node', creatorId, 'reduce');
  assert.equal(reduced.action, 'reduce');

  let state = await store.exportState();
  assert.equal(state.graph.controls?.length, 1);
  assert.equal(state.graph.controls?.[0].action, 'reduce');
  assert.equal(state.graph.currentRevision, 1);
  assert.equal(state.graph.originalBaseline?.revision, 0);
  assert.deepEqual(state.graph.originalBaseline?.controls, []);
  assert.deepEqual(state.graph.originalBaseline?.nodes, before.graph.nodes);
  assert.deepEqual(state.graph.originalBaseline?.edges, before.graph.edges);

  await store.setGraphControl('node', creatorId, 'prefer');
  state = await store.exportState();
  assert.equal(state.graph.controls?.[0].action, 'prefer');
  assert.equal(state.graph.currentRevision, 2);

  const undo = await store.undoLastGraphEdit();
  assert.equal(undo?.action, 'undo');
  state = await store.exportState();
  assert.equal(state.graph.controls?.[0].action, 'reduce');
  assert.equal(state.graph.currentRevision, 3);
  assert.equal(state.evidence.some((record) => record.id === 'control-evidence'), true);

  const restored = await store.restoreOriginalGraph();
  assert.equal(restored, true);
  state = await store.exportState();
  assert.deepEqual(state.graph.controls, []);
  assert.deepEqual(state.graph.nodes, before.graph.nodes);
  assert.deepEqual(state.graph.edges, before.graph.edges);
  assert.equal(state.graph.currentRevision, 4);
  assert.equal(state.evidence.some((record) => record.id === 'control-evidence'), true);

  await store.undoLastGraphEdit();
  state = await store.exportState();
  assert.equal(state.graph.controls?.[0].action, 'reduce');
  assert.equal(state.graph.currentRevision, 5);
  assert.equal(state.graph.userEdits.at(-1)?.action, 'undo');
  assert.equal(state.graph.revisions.at(-1)?.reason, 'graph_undo');
});

test('controlled derived graph targets survive projection churn until the control is cleared', async () => {
  backing.clear();
  const store = new LocalPersonalAlgorithmStore(storage);

  await store.upsertEvidence({
    evidence: {
      kind: 'interaction',
      content: { source: 'youtube', externalId: 'controlled-derived' },
      exposureId: null,
      interaction: 'watched',
      observedAt: '2026-09-27T10:00:00.000Z',
      provenance: { connector: 'youtube', mechanism: 'history_dom' },
      metadata: { title: 'Controlled derived video' },
    },
  }, 'controlled-derived-evidence');

  const marker = 'semantic-concept-materializer-v1';
  await store.reconcileDerivedGraphProjection({
    marker,
    nodes: [{
      id: 'topic:derived:controlled',
      kind: 'topic',
      label: 'Controlled topic',
      content: null,
      provenance: 'inferred',
      confidence: 0.8,
      attributes: { derivedBy: marker, rebuildable: true },
    }],
    edges: [{
      id: 'edge:derived-about:controlled',
      sourceNodeId: 'topic:derived:controlled',
      targetNodeId: 'content:youtube:controlled-derived',
      relation: 'about',
      provenance: 'inferred',
      confidence: 0.8,
      evidenceIds: ['controlled-derived-evidence'],
      attributes: { derivedBy: marker, rebuildable: true },
    }],
  });

  await store.setGraphControl('node', 'topic:derived:controlled', 'prefer');
  await store.reconcileDerivedGraphProjection({ marker, nodes: [], edges: [] });

  let graph = await store.getGraph();
  assert.equal(graph.nodes.some((node) => node.id === 'topic:derived:controlled'), true);

  await store.removeGraphControl('node', 'topic:derived:controlled');
  await store.reconcileDerivedGraphProjection({ marker, nodes: [], edges: [] });

  graph = await store.getGraph();
  assert.equal(graph.nodes.some((node) => node.id === 'topic:derived:controlled'), false);
});
