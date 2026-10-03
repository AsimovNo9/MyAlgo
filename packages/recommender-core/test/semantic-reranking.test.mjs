import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidateEmbeddingText,
  buildGraphNodeEmbeddingText,
  buildSemanticGraphVerificationText,
  classifySemanticCategory,
  createLocalHashEmbeddingProvider,
  createMemoryEmbeddingCache,
  embeddingCacheKey,
  enrichCandidatesWithSemanticReranking,
  semanticInputHash,
  shouldVerifySemanticGraphMatches,
  SEMANTIC_GRAPH_VERIFICATION_PIPELINE_ID,
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

test('graph verifier premise uses bounded content evidence without embedding topic hints', () => {
  assert.equal(
    buildSemanticGraphVerificationText({
      external_id: 'candidate',
      title: 'CRDT implementation',
      description: 'Local-first architecture',
      topics: ['metadata topic that should not be copied into the NLI premise'],
      content_type: 'Education',
      channel_name: 'Systems Lab',
    }),
    'CRDT implementation\nLocal-first architecture\nCategory: Education',
  );
});

test('candidate semantic inputs include transcript excerpts with explicit provenance', async () => {
  const transcriptCandidate = {
    external_id: 'transcript-video',
    title: 'A vague title',
    description: 'Minimal description',
    semantic_transcript: 'Distributed systems CRDT architecture implementation',
    semantic_transcript_source: 'youtube_caption_track',
    semantic_transcript_language: 'en',
    semantic_transcript_auto_generated: false,
  };

  assert.match(buildCandidateEmbeddingText(transcriptCandidate), /Transcript excerpt: Distributed systems CRDT architecture implementation/);
  assert.match(buildSemanticGraphVerificationText(transcriptCandidate), /Transcript excerpt: Distributed systems CRDT architecture implementation/);

  const result = await enrichCandidatesWithSemanticReranking(
    state,
    [transcriptCandidate],
    'CRDTs and local-first software',
    provider,
    createMemoryEmbeddingCache(),
  );
  assert.deepEqual(result.candidates[0].semantic_input_sources, ['metadata', 'transcript']);
  assert.equal(result.diagnostics.transcriptAssistedCandidateCount, 1);
  assert.ok(result.candidates[0].semantic_graph_matches.length > 0);
  assert.deepEqual(result.candidates[0].semantic_graph_matches[0].input_sources, ['metadata', 'transcript']);
  assert.equal(result.candidates[0].semantic_graph_matches[0].transcript_source, 'youtube_caption_track');
  assert.equal(result.candidates[0].semantic_graph_matches[0].transcript_language, 'en');
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
    'CRDTs and local-first software',
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
    'CRDTs and local-first software',
    provider,
    cache,
  );
  assert.equal(provider.calls, callsAfterFirst);
  assert.equal(second.diagnostics.candidateEmbeddingsComputed, 0);
  assert.equal(second.diagnostics.candidateEmbeddingsFromCache, 2);
  assert.ok(second.diagnostics.graphEmbeddingsFromCache >= 4);
});

test('embedding phases identify the graph, mode seed, and candidate workload in order', async () => {
  const phases = [];
  await enrichCandidatesWithSemanticReranking(
    state,
    [{ external_id: 'video', title: 'Distributed systems' }],
    'Work',
    provider,
    createMemoryEmbeddingCache(),
    { onEmbeddingPhase: (phase, inputCount) => phases.push([phase, inputCount]) },
  );
  assert.deepEqual(phases, [
    ['graph_embeddings', 3],
    ['mode_seed', 1],
    ['candidate_embeddings', 1],
    ['embedding_cache_flush', 5],
  ]);
});

test('semantic reranking flushes a persistent embedding cache once per slice', async () => {
  const memory = createMemoryEmbeddingCache();
  let flushes = 0;
  const cache = {
    get: (key) => memory.get(key),
    set: (key, record) => memory.set(key, record),
    async flush() {
      flushes += 1;
    },
  };

  await enrichCandidatesWithSemanticReranking(
    state,
    [{ external_id: 'flush-video', title: 'Distributed systems' }],
    'Work',
    provider,
    cache,
  );

  assert.equal(flushes, 1);
});

test('candidate category comes from graph-derived semantic matches regardless of selected mode', async () => {
  const candidates = [
    { external_id: 'systems', title: 'CRDT local-first software implementation' },
    { external_id: 'ambient', title: 'Ambient music for a calm evening' },
  ];
  const systemsMode = await enrichCandidatesWithSemanticReranking(
    state, candidates, 'CRDTs and local-first software', provider, createMemoryEmbeddingCache(),
  );
  const ambientMode = await enrichCandidatesWithSemanticReranking(
    state, candidates, 'Ambient music', provider, createMemoryEmbeddingCache(),
  );

  assert.equal(systemsMode.candidates[0].semantic_category, 'CRDTs and local-first software');
  assert.equal(systemsMode.candidates[1].semantic_category, 'Ambient music');
  assert.deepEqual(
    systemsMode.candidates.map((candidate) => candidate.semantic_category_scores),
    ambientMode.candidates.map((candidate) => candidate.semantic_category_scores),
  );
  assert.equal(classifySemanticCategory({ 'Distributed systems': 0.34 }).category, null);
  assert.equal(classifySemanticCategory({
    'Distributed systems': 0.7,
    'Local-first software': 0.68,
  }).category, null);
  assert.equal(classifySemanticCategory({
    'Distributed systems': 0.7,
    'Ambient music': 0.4,
  }).category, 'Distributed systems');
});

test('semantic graph verification targets moderate or ambiguous specific matches only', () => {
  assert.equal(shouldVerifySemanticGraphMatches([
    { node_label: 'Clear concept', similarity: 0.82 },
    { node_label: 'Runner up', similarity: 0.5 },
  ]), false);
  assert.equal(shouldVerifySemanticGraphMatches([
    { node_label: 'Moderate concept', similarity: 0.6 },
    { node_label: 'Runner up', similarity: 0.3 },
  ]), true);
  assert.equal(shouldVerifySemanticGraphMatches([
    { node_label: 'Close concept A', similarity: 0.8 },
    { node_label: 'Close concept B', similarity: 0.77 },
  ]), true);
  assert.equal(shouldVerifySemanticGraphMatches([
    { node_label: 'Broad taxonomy', similarity: 0.7, taxonomy_only: true },
  ]), false);
});

test('ambiguous verifier work cannot silently exceed the caller slice limit', async () => {
  const verifier = {
    modelId: 'fixture-deberta',
    modelVersion: 'fixture-nli-v1',
    async verify(items) {
      return { concepts: items.map((item) => item.labels), backend: 'wasm-sandbox' };
    },
  };
  const candidates = Array.from({ length: 5 }, (_, index) => ({
    external_id: `ambiguous-${index}`,
    title: 'Distributed systems CRDT implementation',
    description: 'Practical software architecture',
  }));

  await assert.rejects(
    () => enrichCandidatesWithSemanticReranking(
      state,
      candidates,
      'CRDTs and local-first software',
      provider,
      createMemoryEmbeddingCache(),
      { graphMatchVerifier: verifier, maxGraphVerificationItems: 4 },
    ),
    /Reduce the semantic slice/,
  );
});

test('DeBERTa verifier filters ambiguous embedding graph matches before they become affinities', async () => {
  const calls = [];
  const verifier = {
    modelId: 'fixture-deberta',
    modelVersion: 'fixture-nli-v1',
    async verify(items) {
      calls.push(...items);
      return {
        concepts: items.map(() => ['CRDTs and local-first software']),
        backend: 'wasm-sandbox',
      };
    },
  };

  const result = await enrichCandidatesWithSemanticReranking(
    state,
    [{
      external_id: 'ambiguous-systems',
      title: 'Distributed systems CRDT implementation',
      description: 'Practical software architecture',
    }],
    'CRDTs and local-first software',
    provider,
    createMemoryEmbeddingCache(),
    { graphMatchVerifier: verifier },
  );

  assert.equal(calls.length, 1);
  assert.ok(calls[0].labels.includes('Build reliable distributed systems'));
  assert.ok(calls[0].labels.includes('CRDTs and local-first software'));
  assert.deepEqual(
    result.candidates[0].semantic_graph_matches.map((match) => match.node_label),
    ['CRDTs and local-first software'],
  );
  assert.equal(result.candidates[0].semantic_graph_matches[0].verification_status, 'verified');
  assert.equal(
    result.candidates[0].semantic_graph_matches[0].verification_pipeline_id,
    SEMANTIC_GRAPH_VERIFICATION_PIPELINE_ID,
  );
  assert.equal(
    result.candidates[0].semantic_graph_matches[0].verification_model_version,
    'fixture-deberta@fixture-nli-v1',
  );
  assert.equal(result.diagnostics.graphVerificationRequested, 1);
  assert.equal(result.diagnostics.graphVerificationVerified, 1);
  assert.equal(result.diagnostics.graphVerificationRejected, 1);
  assert.equal(result.diagnostics.graphVerificationBackend, 'wasm-sandbox');
});

test('semantic graph verification can abstain from all ambiguous specific matches', async () => {
  const verifier = {
    modelId: 'fixture-deberta',
    modelVersion: 'fixture-nli-v1',
    async verify(items) {
      return { concepts: items.map(() => []), backend: 'wasm-sandbox' };
    },
  };

  const result = await enrichCandidatesWithSemanticReranking(
    state,
    [{
      external_id: 'rejected-systems',
      title: 'Distributed systems CRDT implementation',
      description: 'Practical software architecture',
    }],
    'CRDTs and local-first software',
    provider,
    createMemoryEmbeddingCache(),
    { graphMatchVerifier: verifier },
  );

  assert.deepEqual(result.candidates[0].semantic_graph_matches, []);
  assert.equal(result.candidates[0].semantic_graph_similarity, 0);
  assert.equal(result.candidates[0].semantic_category, null);
  assert.equal(result.diagnostics.graphVerificationRejected, 2);
});

test('semantic graph verifier failure preserves embedding matches with explicit fallback provenance', async () => {
  const verifier = {
    modelId: 'fixture-deberta',
    modelVersion: 'fixture-nli-v1',
    async verify() {
      throw new Error('fixture verifier unavailable');
    },
  };

  const result = await enrichCandidatesWithSemanticReranking(
    state,
    [{
      external_id: 'fallback-systems',
      title: 'Distributed systems CRDT implementation',
      description: 'Practical software architecture',
    }],
    'CRDTs and local-first software',
    provider,
    createMemoryEmbeddingCache(),
    { graphMatchVerifier: verifier },
  );

  assert.ok(result.candidates[0].semantic_graph_matches.length >= 2);
  assert.equal(
    result.candidates[0].semantic_graph_matches
      .filter((match) => match.verification_pipeline_id === SEMANTIC_GRAPH_VERIFICATION_PIPELINE_ID)
      .every((match) => match.verification_status === 'fallback'),
    true,
  );
  assert.match(result.diagnostics.graphVerificationFallbackReason, /fixture verifier unavailable/);
});

test('clear high-confidence graph matches skip the NLI verifier', async () => {
  let calls = 0;
  const verifier = {
    modelId: 'fixture-deberta',
    modelVersion: 'fixture-nli-v1',
    async verify(items) {
      calls += items.length;
      return { concepts: items.map((item) => item.labels), backend: 'wasm-sandbox' };
    },
  };

  const clearState = {
    ...state,
    graph: {
      ...state.graph,
      nodes: [{
        ...state.graph.nodes.find((node) => node.id === 'concept:ambient'),
        kind: 'topic',
      }],
    },
  };
  const result = await enrichCandidatesWithSemanticReranking(
    clearState,
    [{ external_id: 'ambient-clear', title: 'Ambient music relax unwind' }],
    'Ambient music',
    provider,
    createMemoryEmbeddingCache(),
    { graphMatchVerifier: verifier },
  );

  assert.equal(calls, 0);
  assert.equal(result.diagnostics.graphVerificationRequested, 0);
  assert.equal(result.candidates[0].semantic_graph_matches[0].verification_status, 'not_required');
});

test('changing mode changes semantic mode alignment without changing graph similarity', async () => {
  const cache = createMemoryEmbeddingCache();
  const candidates = [{
    external_id: 'ambient-video',
    title: 'Ambient music to unwind',
    description: 'Relaxing soundscape',
  }];

  const work = await enrichCandidatesWithSemanticReranking(
    state, candidates, 'CRDTs and local-first software', provider, cache,
  );
  const relax = await enrichCandidatesWithSemanticReranking(
    state, candidates, 'Ambient music', provider, cache,
  );

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


test('local hash baseline provides mode-seed separation without claiming graph semantic quality', async () => {
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

  const seedOnlyState = {
    ...state,
    graph: {
      ...state.graph,
      nodes: [],
    },
  };
  const work = await enrichCandidatesWithSemanticReranking(
    seedOnlyState, candidates, 'distributed systems implementation', local, cache,
  );
  const relax = await enrichCandidatesWithSemanticReranking(
    seedOnlyState, candidates, 'ambient music relax', local, cache,
  );

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
