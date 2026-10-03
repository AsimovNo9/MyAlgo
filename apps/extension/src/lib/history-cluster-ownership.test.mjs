import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHistoryClusterCatalog,
  createEmptyHistoryClusterOwnership,
  includeAllHistoryClusters,
  projectHistoryOwnershipForInspection,
  projectHistoryOwnershipForScoring,
  selectHistoryClusters,
  undoHistoryClusterOwnership,
} from './history-cluster-ownership.ts';

const history = [
  {
    externalId: 'a',
    title: 'Python async programming tutorial',
    creator: 'Code Lab',
    historyTimestamp: null,
    historyPosition: 0,
    observedAt: '2026-10-01T10:00:00.000Z',
    provenance: 'youtube_history_dom',
  },
  {
    externalId: 'b',
    title: 'Python concurrency programming guide',
    creator: 'Code Lab',
    historyTimestamp: null,
    historyPosition: 1,
    observedAt: '2026-10-01T09:00:00.000Z',
    provenance: 'youtube_history_dom',
  },
  {
    externalId: 'c',
    title: 'Nursery rhymes for toddlers',
    creator: 'Kids Songs',
    historyTimestamp: null,
    historyPosition: 2,
    observedAt: '2026-10-01T08:00:00.000Z',
    provenance: 'youtube_history_dom',
  },
  {
    externalId: 'd',
    title: 'Bedtime nursery rhymes compilation',
    creator: 'Kids Songs',
    historyTimestamp: null,
    historyPosition: 3,
    observedAt: '2026-10-01T07:00:00.000Z',
    provenance: 'youtube_history_dom',
  },
];

test('history clustering derives multiple local clusters without assigning identity', () => {
  const catalog = buildHistoryClusterCatalog(history, '2026-10-02T10:00:00.000Z');
  assert.equal(catalog.historyCount, 4);
  assert.equal(catalog.clusters.length, 2);
  assert.deepEqual(
    catalog.clusters.map((cluster) => cluster.size).sort(),
    [2, 2],
  );
  assert.equal(catalog.clusters.flatMap((cluster) => cluster.externalIds).length, 4);
});

test('history cluster IDs survive incremental evidence when overlap remains strong', () => {
  const first = buildHistoryClusterCatalog(history, '2026-10-02T10:00:00.000Z');
  const next = buildHistoryClusterCatalog([
    ...history,
    {
      externalId: 'e',
      title: 'Python typing and programming patterns',
      creator: 'Code Lab',
      historyTimestamp: null,
      historyPosition: 4,
      observedAt: '2026-10-01T06:00:00.000Z',
      provenance: 'youtube_history_dom',
    },
  ], '2026-10-02T11:00:00.000Z', first);

  const firstCode = first.clusters.find((cluster) => cluster.externalIds.includes('a'));
  const nextCode = next.clusters.find((cluster) => cluster.externalIds.includes('a'));
  assert.ok(firstCode);
  assert.ok(nextCode);
  assert.equal(nextCode.id, firstCode.id);
});

test('selection and include-all are revisioned and undoable', () => {
  const catalog = buildHistoryClusterCatalog(history);
  let state = createEmptyHistoryClusterOwnership();
  state = selectHistoryClusters(state, [catalog.clusters[0].id], '2026-10-02T10:00:00.000Z');
  assert.equal(state.selectionMode, 'selected');
  assert.equal(state.currentRevision, 1);

  state = includeAllHistoryClusters(state, '2026-10-02T10:01:00.000Z');
  assert.equal(state.selectionMode, 'all');
  assert.equal(state.currentRevision, 2);

  const undone = undoHistoryClusterOwnership(state, '2026-10-02T10:02:00.000Z');
  assert.equal(undone.reverted?.action, 'include_all');
  assert.equal(undone.state.selectionMode, 'selected');
  assert.deepEqual(undone.state.selectedClusterIds, [catalog.clusters[0].id]);
  assert.equal(undone.state.currentRevision, 3);
});

test('scoring projection excludes unselected history evidence but inspection keeps retained payloads', () => {
  const catalog = buildHistoryClusterCatalog(history);
  const selected = selectHistoryClusters(
    createEmptyHistoryClusterOwnership(),
    [catalog.clusters[0].id],
  );
  const allowed = new Set(catalog.clusters[0].evidenceIds);
  const state = {
    schemaVersion: 3,
    evidence: history.map((item) => ({
      id: `interaction:watched:${item.externalId}:history`,
      evidence: {
        kind: 'interaction',
        interaction: 'watched',
        content: { source: 'youtube', externalId: item.externalId },
        observedAt: item.observedAt,
        provenance: { connector: 'youtube', mechanism: 'history_dom' },
        metadata: { title: item.title, creatorName: item.creator },
      },
      confidence: 1,
      retainedAt: item.observedAt,
      retention: { policy: 'default', expiresAt: null },
    })),
    forgottenEvidence: [],
    graph: {
      currentRevision: 7,
      nodes: history.map((item) => ({
        id: `content:youtube:${item.externalId}`,
        kind: 'content',
        label: item.title,
        provenance: 'explicit',
        confidence: null,
        attributes: {},
        createdAt: item.observedAt,
        updatedAt: item.observedAt,
      })),
      edges: history.map((item) => ({
        id: `edge:${item.externalId}`,
        sourceNodeId: `content:youtube:${item.externalId}`,
        targetNodeId: 'creator:youtube:test',
        relation: 'created_by',
        provenance: 'inferred',
        confidence: 1,
        evidenceIds: [`interaction:watched:${item.externalId}:history`],
        attributes: {},
        createdAt: item.observedAt,
        updatedAt: item.observedAt,
      })),
      controls: [],
      revisions: [],
      userEdits: [],
    },
  };

  const scoring = projectHistoryOwnershipForScoring(state, catalog, selected);
  assert.equal(scoring.evidence.length, allowed.size);
  assert.ok(scoring.evidence.every((record) => allowed.has(record.id)));
  assert.equal(scoring.graph.edges.length, allowed.size);

  const inspection = projectHistoryOwnershipForInspection(state, catalog, selected);
  assert.equal(inspection.evidence.length, history.length);
  assert.equal(inspection.graph.edges.length, allowed.size);
});
