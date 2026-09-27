import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DURABLE_SEMANTIC_MODE_PIPELINE_ID,
  buildCandidateModeAffinities,
  buildDurableSemanticModeClusters,
  reconcileDurableSemanticModes,
} from '../src/durable-semantic-modes.ts';
import {
  evaluateModeStability,
} from '../src/replay-evaluation.ts';

const timestamp = '2026-09-27T20:00:00.000Z';

const semanticNode = (id, label, {
  kind = 'topic',
  provenance = 'inferred',
  confidence = 0.86,
  sourceKinds = ['model_topic'],
} = {}) => ({
  id,
  kind,
  label,
  provenance,
  confidence,
  attributes: { sourceKinds },
  createdAt: timestamp,
  updatedAt: timestamp,
});

const contentNode = (id) => ({
  id,
  kind: 'content',
  label: id,
  content: { source: 'youtube', externalId: id.replace('content:youtube:', '') },
  provenance: 'inferred',
  confidence: 1,
  attributes: {},
  createdAt: timestamp,
  updatedAt: timestamp,
});

const aboutEdge = (semanticId, contentId, suffix) => ({
  id: `edge:${suffix}`,
  sourceNodeId: semanticId,
  targetNodeId: contentId,
  relation: 'about',
  provenance: 'inferred',
  confidence: 0.86,
  evidenceIds: [`evidence:${suffix}`],
  attributes: {},
  createdAt: timestamp,
  updatedAt: timestamp,
});

const fixtureState = () => {
  const localAi = semanticNode('topic:local-ai', 'Local AI tooling');
  const offlineLlm = semanticNode('topic:offline-llm', 'Offline LLM workflows');
  const browserAi = semanticNode('topic:browser-ai', 'Browser AI inference');
  const ceramics = semanticNode('topic:ceramics', 'Ceramic glazing');
  const taxonomy = semanticNode('concept:education', 'Education', {
    kind: 'concept',
    confidence: 0.72,
    sourceKinds: ['content_type'],
  });
  const contentIds = [
    'content:youtube:ai-a',
    'content:youtube:ai-b',
    'content:youtube:ai-c',
    'content:youtube:ceramic-a',
    'content:youtube:ceramic-b',
  ];

  return {
    schemaVersion: 2,
    evidence: [],
    graph: {
      nodes: [
        localAi,
        offlineLlm,
        browserAi,
        ceramics,
        taxonomy,
        ...contentIds.map(contentNode),
      ],
      edges: [
        aboutEdge(localAi.id, contentIds[0], 'local-ai-a'),
        aboutEdge(localAi.id, contentIds[1], 'local-ai-b'),
        aboutEdge(localAi.id, contentIds[2], 'local-ai-c'),
        aboutEdge(offlineLlm.id, contentIds[0], 'offline-a'),
        aboutEdge(offlineLlm.id, contentIds[1], 'offline-b'),
        aboutEdge(offlineLlm.id, contentIds[2], 'offline-c'),
        aboutEdge(browserAi.id, contentIds[0], 'browser-a'),
        aboutEdge(browserAi.id, contentIds[1], 'browser-b'),
        aboutEdge(browserAi.id, contentIds[2], 'browser-c'),
        aboutEdge(ceramics.id, contentIds[3], 'ceramic-a'),
        aboutEdge(ceramics.id, contentIds[4], 'ceramic-b'),
        aboutEdge(taxonomy.id, contentIds[0], 'education-a'),
        aboutEdge(taxonomy.id, contentIds[1], 'education-b'),
      ],
      userEdits: [],
      revisions: [],
      currentRevision: 12,
    },
  };
};

test('durable mode clustering groups co-supported canonical concepts and excludes taxonomy', () => {
  const result = buildDurableSemanticModeClusters(fixtureState());

  assert.equal(result.marker, DURABLE_SEMANTIC_MODE_PIPELINE_ID);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].members.length, 3);
  assert.deepEqual(
    result.proposals[0].members.map((member) => member.label).sort(),
    ['Browser AI inference', 'Local AI tooling', 'Offline LLM workflows'],
  );
  assert.equal(
    result.proposals[0].members.some((member) => member.label === 'Education'),
    false,
  );
  assert.equal(
    result.proposals[0].members.some((member) => member.label === 'Ceramic glazing'),
    false,
  );
  assert.equal(result.diagnostics.assignedConceptCount, 3);
});

test('mode reconciliation preserves stable identity while membership evolves', () => {
  const state = fixtureState();
  const first = buildDurableSemanticModeClusters(state);
  const firstReconciled = reconcileDurableSemanticModes(
    null,
    first.proposals,
    state.graph.currentRevision,
    '2026-09-27T20:00:00.000Z',
  );
  const firstMode = firstReconciled.catalog.modes[0];

  assert.ok(firstMode.id.startsWith('mode:inferred:v1:'));
  assert.equal(firstMode.revision, 1);
  assert.equal(firstMode.active, true);

  const nextState = fixtureState();
  nextState.graph.nodes.push(semanticNode('topic:local-models', 'Local model deployment'));
  for (const [index, contentId] of [
    'content:youtube:ai-a',
    'content:youtube:ai-b',
    'content:youtube:ai-c',
  ].entries()) {
    nextState.graph.edges.push(aboutEdge('topic:local-models', contentId, `local-model-${index}`));
  }
  nextState.graph.currentRevision = 13;

  const second = buildDurableSemanticModeClusters(nextState);
  const secondReconciled = reconcileDurableSemanticModes(
    firstReconciled.catalog,
    second.proposals,
    nextState.graph.currentRevision,
    '2026-09-27T21:00:00.000Z',
  );
  const secondMode = secondReconciled.catalog.modes.find((mode) => mode.active);

  assert.equal(secondMode.id, firstMode.id);
  assert.equal(secondMode.revision, 2);
  assert.equal(secondMode.members.length, 4);
  assert.equal(secondReconciled.diagnostics.reusedModeCount, 1);

  const metrics = evaluateModeStability(
    {
      [firstMode.id]: {
        label: firstMode.label,
        memberNodeIds: firstMode.members.map((member) => member.canonicalId),
        revision: firstMode.revision,
      },
    },
    {
      [secondMode.id]: {
        label: secondMode.label,
        memberNodeIds: secondMode.members.map((member) => member.canonicalId),
        revision: secondMode.revision,
      },
    },
  );
  assert.equal(metrics.commonModeCount, 1);
  assert.ok(metrics.averageMemberJaccard >= 0.75);
});

test('unchanged mode membership does not bump the durable revision', () => {
  const state = fixtureState();
  const clustered = buildDurableSemanticModeClusters(state);
  const first = reconcileDurableSemanticModes(
    null,
    clustered.proposals,
    state.graph.currentRevision,
    '2026-09-27T20:00:00.000Z',
  );
  const replay = reconcileDurableSemanticModes(
    first.catalog,
    clustered.proposals,
    state.graph.currentRevision,
    '2026-09-27T20:30:00.000Z',
  );

  assert.equal(replay.catalog.modes[0].id, first.catalog.modes[0].id);
  assert.equal(replay.catalog.modes[0].revision, 1);
});

test('unsupported modes become dormant instead of losing their stable identity', () => {
  const state = fixtureState();
  const clustered = buildDurableSemanticModeClusters(state);
  const first = reconcileDurableSemanticModes(
    null,
    clustered.proposals,
    state.graph.currentRevision,
    '2026-09-27T20:00:00.000Z',
  );
  const prior = first.catalog.modes[0];

  const next = reconcileDurableSemanticModes(
    first.catalog,
    [],
    13,
    '2026-09-27T21:00:00.000Z',
  );
  const dormant = next.catalog.modes[0];

  assert.equal(dormant.id, prior.id);
  assert.equal(dormant.active, false);
  assert.equal(dormant.revision, prior.revision + 1);
  assert.equal(dormant.lastSupportedAt, prior.lastSupportedAt);
});

test('candidate affinities preserve multiple qualified durable modes and source provenance', () => {
  const catalog = {
    pipelineId: DURABLE_SEMANTIC_MODE_PIPELINE_ID,
    graphRevision: 4,
    generatedAt: timestamp,
    modes: [
      {
        id: 'mode:inferred:v1:ai',
        label: 'Local AI tooling',
        revision: 2,
        members: [{
          canonicalId: 'canonical:ai',
          label: 'Local AI tooling',
          weight: 1,
          sourceNodeIds: ['topic:local-ai'],
          supportContentIds: ['content:youtube:ai-a', 'content:youtube:ai-b'],
        }],
        provenance: 'inferred',
        pipelineId: DURABLE_SEMANTIC_MODE_PIPELINE_ID,
        graphRevision: 4,
        createdAt: timestamp,
        lastSupportedAt: timestamp,
        active: true,
        pinned: false,
      },
      {
        id: 'mode:inferred:v1:systems',
        label: 'Distributed systems',
        revision: 1,
        members: [{
          canonicalId: 'canonical:systems',
          label: 'Distributed systems',
          weight: 0.8,
          sourceNodeIds: ['topic:systems'],
          supportContentIds: ['content:youtube:sys-a', 'content:youtube:sys-b'],
        }],
        provenance: 'inferred',
        pipelineId: DURABLE_SEMANTIC_MODE_PIPELINE_ID,
        graphRevision: 4,
        createdAt: timestamp,
        lastSupportedAt: timestamp,
        active: true,
        pinned: false,
      },
    ],
  };

  const affinities = buildCandidateModeAffinities([
    {
      node_id: 'topic:local-ai',
      node_label: 'Local AI tooling',
      canonical_id: 'canonical:ai-embedding-merged',
      source_node_ids: ['topic:local-ai'],
      similarity: 0.72,
      weight: 0.68,
      taxonomy_only: false,
    },
    {
      node_id: 'topic:systems',
      node_label: 'Distributed systems',
      canonical_id: 'canonical:systems',
      source_node_ids: ['topic:systems'],
      similarity: 0.61,
      weight: 0.55,
      taxonomy_only: false,
    },
  ], catalog);

  assert.equal(affinities.length, 2);
  assert.equal(affinities[0].modeId, 'mode:inferred:v1:ai');
  assert.equal(affinities[0].affinity, 0.72);
  assert.deepEqual(affinities[0].sourceNodeIds, ['topic:local-ai']);
  assert.equal(affinities[1].modeId, 'mode:inferred:v1:systems');
  assert.equal(affinities[1].affinity, 0.488);
});
