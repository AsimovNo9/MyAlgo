import test from 'node:test';
import assert from 'node:assert/strict';

const backing = new Map();

const storage = {
  async get(keys) {
    return Object.fromEntries(keys
      .filter((key) => backing.has(key))
      .map((key) => [key, backing.get(key)]));
  },
  async set(values) {
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

test('local store persists normalized evidence and graph content nodes across restart', async () => {
  backing.clear();
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
      content: { source: 'youtube', externalId: 'yt-2' },
    },
  }, 'evidence-3');

  assert.equal((await store.deleteEvidence(second.id)), true);
  assert.equal(await store.getEvidence(second.id), null);
  assert.equal(await store.deleteEvidenceForContent('youtube', 'yt-2'), 1);

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
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.graph.nodes.some((item) => item.id === 'topic:testing'), true);

  await store.reset();
  assert.deepEqual(await store.listEvidence(), []);
  assert.equal((await store.getGraph()).currentRevision, 0);
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
