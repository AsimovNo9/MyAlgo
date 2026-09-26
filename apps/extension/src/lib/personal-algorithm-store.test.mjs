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
  assert.equal((await store.getGraph()).nodes.length, 2);
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
  assert.equal(graph.currentRevision, 2);
  assert.equal(graph.userEdits.length, 2);
  assert.equal(graph.revisions.length, 2);

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
  assert.equal(JSON.parse(exportedJson).schemaVersion, 2);
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.graph.nodes.some((item) => item.id === 'topic:testing'), true);

  await store.reset();
  assert.deepEqual(await store.listEvidence(), []);
  assert.equal((await store.getGraph()).currentRevision, 0);
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
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].kind, 'content');
  assert.equal(graph.nodes[0].label, 'Metadata title');
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

test('legacy schema v1 migrates to v2 without discarding evidence or nodes', async () => {
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
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.evidence.length, 1);
  assert.deepEqual(state.graph.edges[0].evidenceIds, []);
  assert.equal(backing.get('personal-algorithm-state').schemaVersion, 2);
});

test('invalid or unknown schema versions migrate to a safe empty v2 state', async () => {
  backing.clear();
  backing.set('personal-algorithm-state', {
    schemaVersion: 99,
    evidence: [{ corrupt: true }],
    graph: { nodes: [], edges: [], userEdits: [], revisions: [], currentRevision: 1 },
  });

  const store = new LocalPersonalAlgorithmStore(storage);
  const state = await store.exportState();
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.evidence, []);
  assert.equal(state.graph.currentRevision, 0);
});
