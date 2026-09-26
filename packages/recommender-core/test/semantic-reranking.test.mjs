import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidateEmbeddingText,
  buildGraphNodeEmbeddingText,
  createLocalHashEmbeddingProvider,
  createMemoryEmbeddingCache,
  embeddingCacheKey,
  enrichCandidatesWithSemanticReranking,
  semanticInputHash,
} from '../src/semantic-reranking.ts';

const state = {
  schemaVersion: 2,
  evidence: [],
  graph: {
    nodes: [
      {
        id: 'objective:build',
        kind: 'objective',
        label: 'Build reliable distributed systems',
        provenance: 'explicit',
        confidence: 1,
        attributes: { description: 'Practical software architecture and implementation' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'topic:crdt',
        kind: 'topic',
        label: 'CRDTs and local-first software',
        provenance: 'explicit',
        confidence: 0.9,
        attributes: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'concept:ambient',
        kind: 'concept',
        label: 'Ambient music',
        provenance: 'inferred',
        confidence: 0.8,
        attributes: {},
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    edges: [],
    userEdits: [],
    revisions: [],
    currentRevision: 12,
  },
};

const vectorFor = (text) => {
  const value = text.toLowerCase();
  const vector = [0, 0, 0, 0];
  if (/build|implementation|software|distributed|crdt|architecture|engineering|practical/.test(value)) vector[0] += 1;
  if (/learn|understand|study|tutorial|lecture|course|concept/.test(value)) vector[1] += 1;
  if (/relax|ambient|music|unwind|enjoy/.test(value)) vector[2] += 1;
  if (/history|photography|documentary/.test(value)) vector[3] += 1;
  if (vector.every((item) => item === 0)) vector[3] = 0.2;
  return vector;
};

const provider = {
  modelId: 'fixture-semantic-model',
  modelVersion: 'fixture-v1',
  dimensions: 4,
  calls: 0,
  async embed(texts) {
    this.calls += texts.length;
    return texts.map(vectorFor);
  },
};

test('candidate and graph texts preserve enriched semantic context', () => {
  assert.equal(
    buildCandidateEmbeddingText({
      external_id: 'candidate',
      title: 'CRDT implementation',
      description: 'Local-first architecture',
      topics: ['distributed systems'],
      content_type: 'Education',
      channel_name: 'Systems Lab',
    }),
    'CRDT implementation | Local-first architecture | distributed systems | Education | Systems Lab',
  );

  assert.match(
    buildGraphNodeEmbeddingText(state.graph.nodes[0]),
    /Build reliable distributed systems.*Practical software architecture and implementation/,
  );
});

test('semantic input hashes and cache keys are stable but model-version scoped', () => {
  const first = semanticInputHash('same input');
  const second = semanticInputHash('same input');
  assert.equal(first, second);
  assert.notEqual(first, semanticInputHash('different input'));

  const keyV1 = embeddingCacheKey(provider, 'content', 'video-a', first);
  const keyV2 = embeddingCacheKey({ ...provider, modelVersion: 'fixture-v2' }, 'content', 'video-a', first);
  assert.notEqual(keyV1, keyV2);
});

test('semantic reranking derives graph and mode similarities and reuses cached embeddings', async () => {
  provider.calls = 0;
  const cache = createMemoryEmbeddingCache();
  const candidates = [
    {
      external_id: 'work-video',
      title: 'Implement CRDTs in production',
      description: 'Distributed systems architecture and debugging',
      channel_name: 'Engineering Lab',
    },
    {
      external_id: 'relax-video',
      title: 'Ambient music for a calm evening',
      description: 'Relax and unwind',
      channel_name: 'Quiet Sound',
    },
  ];

  const first = await enrichCandidatesWithSemanticReranking(
    state,
    candidates,
    'Work',
    provider,
    cache,
  );

  const work = first.candidates.find((candidate) => candidate.external_id === 'work-video');
  const relax = first.candidates.find((candidate) => candidate.external_id === 'relax-video');
  assert.ok(work.semantic_graph_similarity > relax.semantic_graph_similarity);
  assert.ok(work.semantic_mode_similarity > relax.semantic_mode_similarity);
  assert.equal(work.semantic_model_version, 'fixture-semantic-model@fixture-v1');
  assert.equal(first.modeProfile.graph_revision, 12);
  assert.ok(first.modeProfile.semantic_terms.includes('Build reliable distributed systems'));
  assert.ok(first.diagnostics.graphEmbeddingsComputed > 0);
  assert.equal(first.diagnostics.candidateEmbeddingsComputed, 2);

  assert.ok(work.semantic_graph_matches.length > 0);
  assert.ok(work.semantic_graph_matches.length <= 3);
  assert.equal(
    work.semantic_graph_matches.some((match) => match.node_id === 'objective:build'),
    true,
  );

  const callsAfterFirst = provider.calls;
  const second = await enrichCandidatesWithSemanticReranking(
    state,
    candidates,
    'Work',
    provider,
    cache,
  );
  assert.equal(provider.calls, callsAfterFirst);
  assert.equal(second.diagnostics.candidateEmbeddingsComputed, 0);
  assert.equal(second.diagnostics.candidateEmbeddingsFromCache, 2);
  assert.ok(second.diagnostics.graphEmbeddingsFromCache >= 4);
});

test('changing mode changes semantic mode alignment without changing graph similarity', async () => {
  const cache = createMemoryEmbeddingCache();
  const candidates = [{
    external_id: 'ambient-video',
    title: 'Ambient music to unwind',
    description: 'Relaxing soundscape',
  }];

  const work = await enrichCandidatesWithSemanticReranking(state, candidates, 'Work', provider, cache);
  const relax = await enrichCandidatesWithSemanticReranking(state, candidates, 'Relax', provider, cache);

  assert.equal(
    work.candidates[0].semantic_graph_similarity,
    relax.candidates[0].semantic_graph_similarity,
  );
  assert.ok(
    relax.candidates[0].semantic_mode_similarity
      > work.candidates[0].semantic_mode_similarity,
  );
});


test('local hash embedding baseline is deterministic and separates unrelated mode text', async () => {
  const local = createLocalHashEmbeddingProvider(96);
  const [workA, workB, relax] = await local.embed([
    'distributed systems implementation architecture',
    'distributed software architecture implementation',
    'ambient music relax unwind',
  ]);

  assert.deepEqual(await local.embed(['distributed systems implementation architecture']), [workA]);
  const dot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
  const magnitude = (vector) => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  const cosine = (left, right) => dot(left, right) / (magnitude(left) * magnitude(right));

  assert.ok(cosine(workA, workB) > cosine(workA, relax));
});


test('local baseline produces different candidate ordering across Work and Relax semantic modes', async () => {
  const local = createLocalHashEmbeddingProvider(192);
  const cache = createMemoryEmbeddingCache();
  const candidates = [
    {
      external_id: 'systems',
      title: 'Practical distributed systems implementation',
      description: 'Build reliable software architecture',
    },
    {
      external_id: 'ambient',
      title: 'Ambient music to relax and unwind',
      description: 'Calm evening listening',
    },
  ];

  const work = await enrichCandidatesWithSemanticReranking(state, candidates, 'Work', local, cache);
  const relax = await enrichCandidatesWithSemanticReranking(state, candidates, 'Relax', local, cache);

  const workById = Object.fromEntries(work.candidates.map((candidate) => [candidate.external_id, candidate]));
  const relaxById = Object.fromEntries(relax.candidates.map((candidate) => [candidate.external_id, candidate]));

  assert.ok(
    workById.systems.semantic_mode_similarity
      > workById.ambient.semantic_mode_similarity,
  );
  assert.ok(
    relaxById.ambient.semantic_mode_similarity
      > relaxById.systems.semantic_mode_similarity,
  );
});
