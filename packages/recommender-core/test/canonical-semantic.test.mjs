import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_SEMANTIC_PIPELINE_ID,
  buildCanonicalSemanticConcepts,
} from '../src/canonical-semantic.ts';

const graphNode = ({
  id,
  kind = 'topic',
  label,
  provenance = 'inferred',
  confidence = 0.82,
  sourceKinds = ['model_topic'],
}) => ({
  id,
  kind,
  label,
  provenance,
  confidence,
  attributes: sourceKinds ? {
    derivedBy: 'semantic-concept-materializer-v1',
    sourceKinds,
  } : {},
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
});

const edgeFor = (nodeId, suffix) => ({
  id: `edge:${suffix}`,
  sourceNodeId: nodeId,
  targetNodeId: `content:youtube:${suffix}`,
  relation: 'about',
  provenance: 'inferred',
  confidence: 0.8,
  evidenceIds: [`evidence:${suffix}`],
  attributes: {},
  createdAt: '2026-09-27T00:00:00.000Z',
  updatedAt: '2026-09-27T00:00:00.000Z',
});

const baseState = {
  schemaVersion: 2,
  evidence: [],
  graph: {
    nodes: [
      graphNode({ id: 'topic:grok-bot', label: 'grok bot' }),
      graphNode({ id: 'topic:grok-how', label: 'how to use grok bot' }),
      graphNode({ id: 'topic:grok-cases', label: 'grok bot use cases' }),
      graphNode({ id: 'topic:grok-tutorial', label: 'grok bot tutorial' }),
      graphNode({
        id: 'concept:education',
        kind: 'concept',
        label: 'Education',
        confidence: 0.72,
        sourceKinds: ['content_type'],
      }),
    ],
    edges: [
      edgeFor('topic:grok-bot', 'grok-a'),
      edgeFor('topic:grok-how', 'grok-b'),
      edgeFor('topic:grok-cases', 'grok-c'),
      edgeFor('topic:grok-tutorial', 'grok-d'),
      edgeFor('concept:education', 'education'),
    ],
    userEdits: [],
    revisions: [],
    currentRevision: 1,
  },
};

test('deterministic alias normalization collapses Grok variants into one canonical neighbourhood', () => {
  const result = buildCanonicalSemanticConcepts(baseState);
  const grokIds = [
    'topic:grok-bot',
    'topic:grok-how',
    'topic:grok-cases',
    'topic:grok-tutorial',
  ].map((nodeId) => result.assignmentByNodeId[nodeId]);

  assert.equal(new Set(grokIds).size, 1);
  const grok = result.concepts.find((concept) => concept.id === grokIds[0]);
  assert.ok(grok);
  assert.equal(grok.pipelineId, CANONICAL_SEMANTIC_PIPELINE_ID);
  assert.equal(grok.normalizedLabel, 'grok bot');
  assert.deepEqual(grok.sourceNodeIds, [
    'topic:grok-bot',
    'topic:grok-cases',
    'topic:grok-how',
    'topic:grok-tutorial',
  ]);
  assert.deepEqual(grok.evidenceIds, [
    'evidence:grok-a',
    'evidence:grok-b',
    'evidence:grok-c',
    'evidence:grok-d',
  ]);
  assert.equal(result.diagnostics.mergedNodeCount, 3);
});

test('content-type taxonomy remains separate from specific semantic interests', () => {
  const result = buildCanonicalSemanticConcepts(baseState);
  const taxonomy = result.concepts.find((concept) => (
    concept.sourceNodeIds.includes('concept:education')
  ));
  const grok = result.concepts.find((concept) => (
    concept.sourceNodeIds.includes('topic:grok-bot')
  ));

  assert.ok(taxonomy);
  assert.ok(grok);
  assert.equal(taxonomy.taxonomyOnly, true);
  assert.equal(grok.taxonomyOnly, false);
  assert.notEqual(taxonomy.id, grok.id);
});

test('embedding similarity may merge compatible inferred concepts but never similarity-only explicit distinctions', () => {
  const state = structuredClone(baseState);
  state.graph.nodes.push(
    graphNode({ id: 'topic:local-ai-tooling', label: 'Local AI tooling' }),
    graphNode({ id: 'topic:local-ai-tools', label: 'Local AI tools' }),
    graphNode({
      id: 'topic:explicit-local-ai-tooling',
      label: 'Local AI tooling workflows',
      provenance: 'explicit',
      confidence: 1,
      sourceKinds: null,
    }),
  );

  const embeddings = new Map([
    ['topic:local-ai-tooling', [1, 0, 0]],
    ['topic:local-ai-tools', [0.999, 0.001, 0]],
    ['topic:explicit-local-ai-tooling', [1, 0, 0]],
  ]);
  const result = buildCanonicalSemanticConcepts(state, {
    embeddingsByNodeId: embeddings,
    embeddingModelVersion: 'fixture@mxbai',
    embeddingSimilarityThreshold: 0.9,
  });

  assert.equal(
    result.assignmentByNodeId['topic:local-ai-tooling'],
    result.assignmentByNodeId['topic:local-ai-tools'],
  );
  assert.notEqual(
    result.assignmentByNodeId['topic:local-ai-tooling'],
    result.assignmentByNodeId['topic:explicit-local-ai-tooling'],
  );
  assert.equal(result.diagnostics.embeddingMergeCount, 1);
  assert.ok(result.diagnostics.explicitSimilarityMergeBlockedCount >= 1);
});

test('canonical IDs are deterministic across graph insertion order and unrelated graph churn', () => {
  const first = buildCanonicalSemanticConcepts(baseState);
  const churned = structuredClone(baseState);
  churned.graph.nodes.reverse();
  churned.graph.edges.reverse();
  churned.graph.nodes.push(
    graphNode({ id: 'topic:unrelated', label: 'Ceramic glazing techniques' }),
  );
  churned.graph.currentRevision += 1;

  const second = buildCanonicalSemanticConcepts(churned);
  for (const nodeId of [
    'topic:grok-bot',
    'topic:grok-how',
    'topic:grok-cases',
    'topic:grok-tutorial',
    'concept:education',
  ]) {
    assert.equal(second.assignmentByNodeId[nodeId], first.assignmentByNodeId[nodeId]);
  }
});
