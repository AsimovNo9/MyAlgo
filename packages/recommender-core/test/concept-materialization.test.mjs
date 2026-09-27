import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSemanticConceptMaterialization,
  SEMANTIC_CONCEPT_MATERIALIZER_ID,
} from '../src/concept-materialization.ts';
import { evaluateConceptMaterialization } from '../src/replay-evaluation.ts';

const at = '2026-09-27T10:00:00.000Z';

const contentNode = (externalId) => ({
  id: `content:youtube:${externalId}`,
  kind: 'content',
  label: externalId,
  content: { source: 'youtube', externalId },
  provenance: 'explicit',
  confidence: null,
  attributes: {},
  createdAt: at,
  updatedAt: at,
});

const interactionRecord = (id, externalId, title, interaction = 'watched') => ({
  id,
  evidence: {
    kind: 'interaction',
    content: { source: 'youtube', externalId },
    exposureId: null,
    interaction,
    observedAt: at,
    provenance: { connector: 'youtube', mechanism: 'history_dom' },
    metadata: { title },
  },
  confidence: 1,
  retainedAt: at,
  retention: { policy: 'default', expiresAt: null },
});

const exposureRecord = (id, externalId, title) => ({
  id,
  evidence: {
    kind: 'exposure',
    exposureId: `${externalId}|home||0`,
    content: { source: 'youtube', externalId },
    surface: 'home',
    section: null,
    position: 0,
    observedAt: at,
    provenance: { connector: 'youtube', mechanism: 'home_dom' },
    metadata: { title },
  },
  confidence: 1,
  retainedAt: at,
  retention: { policy: 'default', expiresAt: null },
});

const state = (evidence, extraNodes = []) => ({
  schemaVersion: 2,
  evidence,
  graph: {
    nodes: [
      ...new Map(
        evidence.map((record) => [
          record.evidence.content.externalId,
          contentNode(record.evidence.content.externalId),
        ]),
      ).values(),
      ...extraNodes,
    ],
    edges: [],
    userEdits: [],
    revisions: [],
    currentRevision: 0,
  },
});

test('materializes repeated candidate topics and content types only with interaction support', () => {
  const inputState = state([
    interactionRecord('e1', 'v1', 'Elden Ring bleed build guide'),
    interactionRecord('e2', 'v2', 'Elden Ring PvP build'),
    exposureRecord('e3', 'v3', 'Elden Ring speedrun'),
  ]);

  const result = buildSemanticConceptMaterialization(inputState, [
    { external_id: 'v1', topics: ['Elden Ring', 'RPG'], content_type: 'Gaming' },
    { external_id: 'v2', topics: ['Elden Ring', 'RPG'], content_type: 'Gaming' },
    { external_id: 'v3', topics: ['Elden Ring'], content_type: 'Gaming' },
  ]);

  const labels = result.proposals.map(({ kind, label }) => ({ kind, label }));
  const metrics = evaluateConceptMaterialization([
    { kind: 'topic', label: 'Elden Ring' },
    { kind: 'topic', label: 'RPG' },
    { kind: 'concept', label: 'Gaming' },
  ], labels);

  assert.equal(result.marker, SEMANTIC_CONCEPT_MATERIALIZER_ID);
  assert.equal(result.diagnostics.interactionSupportedContentCount, 2);
  assert.equal(result.diagnostics.candidateWithInteractionSupportCount, 2);
  assert.equal(metrics.recall, 1);
  assert.equal(metrics.precision, 1);
  assert.equal(metrics.duplicateNormalizedLabelCount, 0);

  const eldenRing = result.proposals.find((proposal) => proposal.label === 'Elden Ring');
  assert.equal(eldenRing?.supportCount, 2);
  assert.deepEqual(eldenRing?.evidenceIds, ['e1', 'e2']);
  assert.equal(
    result.edges.some((edge) => edge.targetNodeId === 'content:youtube:v3'),
    false,
  );
});

test('passive exposure and acquired metadata alone cannot create preference concepts', () => {
  const inputState = state([
    exposureRecord('e1', 'v1', 'Distributed systems tutorial'),
    exposureRecord('e2', 'v2', 'Distributed systems guide'),
    exposureRecord('e3', 'v3', 'Distributed systems explained'),
  ]);

  const result = buildSemanticConceptMaterialization(inputState, [
    { external_id: 'v1', topics: ['Distributed systems'], content_type: 'Education' },
    { external_id: 'v2', topics: ['Distributed systems'], content_type: 'Education' },
    { external_id: 'v3', topics: ['Distributed systems'], content_type: 'Education' },
  ]);

  assert.equal(result.nodes.length, 0);
  assert.equal(result.edges.length, 0);
  assert.equal(result.diagnostics.interactionSupportedContentCount, 0);
});

test('repeated interaction titles cannot create standalone taxonomy nodes', () => {
  const inputState = state([
    interactionRecord('e1', 'v1', 'Distributed systems tutorial'),
    interactionRecord('e2', 'v2', 'Distributed systems guide'),
    interactionRecord('e3', 'v3', 'Distributed systems explained'),
  ]);

  const result = buildSemanticConceptMaterialization(inputState, []);

  assert.equal(result.proposals.length, 0);
  assert.equal(result.nodes.length, 0);
  assert.equal(result.diagnostics.rawLabelCount, 0);
});

test('explicit semantic nodes suppress same-kind derived duplicates', () => {
  const explicitTopic = {
    id: 'topic:explicit:distributed',
    kind: 'topic',
    label: 'Distributed systems',
    provenance: 'explicit',
    confidence: 1,
    attributes: {},
    createdAt: at,
    updatedAt: at,
  };
  const inputState = state([
    interactionRecord('e1', 'v1', 'Distributed systems tutorial'),
    interactionRecord('e2', 'v2', 'Distributed systems guide'),
  ], [explicitTopic]);

  const result = buildSemanticConceptMaterialization(inputState, [
    { external_id: 'v1', topics: ['Distributed systems'] },
    { external_id: 'v2', topics: ['Distributed systems'] },
  ]);

  assert.equal(result.proposals.some((proposal) => (
    proposal.kind === 'topic' && proposal.label === 'Distributed systems'
  )), false);
  assert.equal(result.diagnostics.skippedExplicitLabelCount, 1);
});

test('materialization is deterministic, bounded and order independent', () => {
  const evidence = [
    interactionRecord('e1', 'v1', 'Local AI tooling tutorial'),
    interactionRecord('e2', 'v2', 'Local AI tooling guide'),
    interactionRecord('e3', 'v3', 'Local AI tooling explained'),
  ];
  const candidates = [
    { external_id: 'v1', topics: ['Local AI', 'LLM', 'WebGPU'], content_type: 'Education' },
    { external_id: 'v2', topics: ['Local AI', 'LLM', 'WebGPU'], content_type: 'Education' },
    { external_id: 'v3', topics: ['Local AI', 'LLM', 'WebGPU'], content_type: 'Education' },
  ];

  const first = buildSemanticConceptMaterialization(state(evidence), candidates, { maxProposals: 3 });
  const second = buildSemanticConceptMaterialization(
    state([...evidence].reverse()),
    [...candidates].reverse(),
    { maxProposals: 3 },
  );

  assert.deepEqual(second, first);
  assert.equal(first.nodes.length, 3);
  assert.ok(first.edges.every((edge) => edge.evidenceIds.length > 0));
});


test('content type suppresses duplicate candidate-topic taxonomy at the same normalized label', () => {
  const inputState = state([
    interactionRecord('e1', 'v1', 'Music mix one'),
    interactionRecord('e2', 'v2', 'Music mix two'),
  ]);

  const result = buildSemanticConceptMaterialization(inputState, [
    { external_id: 'v1', topics: ['Music', 'Lo-fi'], content_type: 'Music' },
    { external_id: 'v2', topics: ['music', 'Lo-fi'], content_type: 'Music' },
  ]);

  assert.equal(
    result.proposals.some((proposal) => proposal.kind === 'topic' && proposal.label.toLowerCase() === 'music'),
    false,
  );
  assert.equal(
    result.proposals.some((proposal) => proposal.kind === 'concept' && proposal.label === 'Music'),
    true,
  );
  assert.equal(
    result.proposals.some((proposal) => proposal.kind === 'topic' && proposal.label === 'Lo-fi'),
    true,
  );
});

test('diagnostics expose qualification pressure before the materialization cap', () => {
  const inputState = state([
    interactionRecord('e1', 'v1', 'One'),
    interactionRecord('e2', 'v2', 'Two'),
  ]);

  const result = buildSemanticConceptMaterialization(inputState, [
    { external_id: 'v1', topics: ['Alpha', 'Beta', 'Gamma'] },
    { external_id: 'v2', topics: ['Alpha', 'Beta', 'Gamma'] },
  ], { maxProposals: 2 });

  assert.equal(result.diagnostics.qualifiedBeforeCap, 3);
  assert.equal(result.diagnostics.qualifiedProposalCount, 2);
  assert.equal(result.diagnostics.droppedByCap, 1);
});
