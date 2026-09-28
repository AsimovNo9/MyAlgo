import test from 'node:test';
import assert from 'node:assert/strict';

import { applyDurableModeToRetrievalProfile, applyModeToRetrievalProfile, buildGraphRetrievalProfile, buildGraphRetrievalRevision, buildRecommendationQueryPlans, buildRetrievalCoordinatorPlan, buildSemanticModeProfile, cosineSimilarity, evaluateRetrievalModeChanges, semanticModeSeed, weightedEmbeddingCentroid } from '../src/index.ts';

test('buildRetrievalCoordinatorPlan allocates more budget to under-covered interests', () => {
  const plan = buildRetrievalCoordinatorPlan({
    topics: ['Gaming', 'AI'],
    currentCoverage: { gaming: 1, ai: 5 },
    targetPerTopic: 4,
    lanes: ['observed', 'rss', 'web_search', 'explore'],
  });

  const gaming = plan.topicBudgets.find((item) => item.topic === 'gaming');
  const ai = plan.topicBudgets.find((item) => item.topic === 'ai');

  assert.ok(gaming);
  assert.ok(ai);
  assert.ok(gaming.requiredCoverage > 0);
  assert.ok(gaming.laneAssignments.some((lane) => lane.lane === 'rss'));
  assert.ok(ai.requiredCoverage === 0);
});

test('buildRetrievalCoordinatorPlan keeps budgets bounded and returns a total plan', () => {
  const plan = buildRetrievalCoordinatorPlan({
    topics: ['Design'],
    currentCoverage: { design: 2 },
    targetPerTopic: 3,
    lanes: ['observed', 'rss', 'web_search'],
  });

  assert.equal(plan.topicBudgets.length, 1);
  assert.equal(plan.totalBudget > 0, true);
  assert.equal(plan.lanes.includes('web_search'), true);
});


test('buildGraphRetrievalProfile uses graph concepts/objectives without raw content titles', () => {
  const state = {
    schemaVersion: 2,
    evidence: [],
    graph: {
      nodes: [
        { id: 'objective:1', kind: 'objective', label: 'Learn distributed systems', provenance: 'explicit', confidence: 1, attributes: {}, createdAt: '', updatedAt: '' },
        { id: 'topic:1', kind: 'topic', label: 'Local-first software', provenance: 'explicit', confidence: 1, attributes: { format: 'Talk' }, createdAt: '', updatedAt: '' },
        { id: 'concept:1', kind: 'concept', label: 'Distributed systems', provenance: 'inferred', confidence: 0.9, attributes: {}, createdAt: '', updatedAt: '' },
        { id: 'creator:1', kind: 'creator', label: 'Martin Kleppmann', provenance: 'inferred', confidence: 0.8, attributes: {}, createdAt: '', updatedAt: '' },
        { id: 'content:1', kind: 'content', label: 'RAW WATCHED VIDEO TITLE', provenance: 'inferred', confidence: 1, attributes: {}, createdAt: '', updatedAt: '' },
        { id: 'concept:low', kind: 'concept', label: 'Low confidence noise', provenance: 'inferred', confidence: 0.2, attributes: {}, createdAt: '', updatedAt: '' },
      ],
      edges: [],
      userEdits: [],
      revisions: [],
      currentRevision: 12,
    },
  };

  const profile = buildGraphRetrievalProfile(state);
  assert.equal(profile.goal, 'Learn distributed systems');
  assert.deepEqual(profile.explicitTopics, ['Local-first software', 'Distributed systems']);
  assert.deepEqual(profile.creatorTerms, ['Martin Kleppmann']);
  assert.deepEqual(profile.preferredFormats, ['talk']);
  assert.equal(profile.semanticTerms.includes('RAW WATCHED VIDEO TITLE'), false);
  assert.equal(profile.semanticTerms.includes('Low confidence noise'), false);
});

test('graph retrieval query plans are bounded, deterministic, and revision tagged', () => {
  const state = {
    schemaVersion: 2,
    evidence: [],
    graph: {
      nodes: [
        { id: 'objective:1', kind: 'objective', label: 'Learn distributed systems', provenance: 'explicit', confidence: 1, attributes: {}, createdAt: '', updatedAt: '' },
        { id: 'topic:1', kind: 'topic', label: 'Local-first software', provenance: 'explicit', confidence: 1, attributes: { format: 'talk' }, createdAt: '', updatedAt: '' },
      ],
      edges: [],
      userEdits: [],
      revisions: [],
      currentRevision: 12,
    },
  };
  const profile = buildGraphRetrievalProfile(state);
  const first = buildRecommendationQueryPlans(profile, 4, String(state.graph.currentRevision));
  const second = buildRecommendationQueryPlans(profile, 4, String(state.graph.currentRevision));
  assert.deepEqual(first, second);
  assert.ok(first.length <= 4);
  assert.ok(first.every((plan) => plan.algorithmRevision === '12'));
  assert.ok(first.some((plan) => plan.lane === 'goal'));
});


test('query planner supports creator-only graph retrieval before semantic topic nodes exist', () => {
  const profile = {
    goal: '',
    language: null,
    explicitTopics: [],
    aliases: [],
    intents: [],
    semanticTerms: ['Creator A'],
    positiveRuleTerms: [],
    negativeRuleTerms: [],
    preferredFormats: ['guide'],
    creatorTerms: ['Creator A'],
  };
  const plans = buildRecommendationQueryPlans(profile, 3, '9');
  assert.deepEqual(plans, [{
    text: 'Creator A guide',
    lane: 'creator',
    topics: [],
    algorithmRevision: '9',
  }]);
});


test('buildGraphRetrievalRevision changes when retrieval-relevant graph state changes', () => {
  const state = {
    schemaVersion: 2,
    evidence: [],
    graph: {
      nodes: [
        { id: 'creator:youtube:a', kind: 'creator', label: 'Creator A', provenance: 'inferred', confidence: 1, attributes: {}, createdAt: '', updatedAt: '' },
      ],
      edges: [],
      userEdits: [],
      revisions: [],
      currentRevision: 0,
    },
  };
  const first = buildGraphRetrievalRevision(state);
  const second = buildGraphRetrievalRevision({
    ...state,
    graph: {
      ...state.graph,
      nodes: [
        ...state.graph.nodes,
        { id: 'topic:local-first', kind: 'topic', label: 'Local-first', provenance: 'explicit', confidence: 1, attributes: {}, createdAt: '', updatedAt: '' },
      ],
    },
  });

  assert.notEqual(first, second);
  assert.equal(first.startsWith('graph-2-'), true);
});


test('inferred mode changes retrieval intent without replacing the graph goal', () => {
  const base = {
    goal: 'Distributed systems',
    language: null,
    explicitTopics: ['CRDTs'],
    aliases: [],
    intents: [],
    semanticTerms: ['CRDTs'],
    positiveRuleTerms: [],
    negativeRuleTerms: [],
    preferredFormats: ['talk'],
    creatorTerms: [],
  };

  const localFirst = applyModeToRetrievalProfile(base, 'Local-first software');
  const neutral = applyModeToRetrievalProfile(base, 'Default');

  assert.equal(localFirst.goal, 'Distributed systems Local-first software');
  assert.deepEqual(localFirst.intents, ['Local-first software']);
  assert.equal(localFirst.semanticTerms.includes('Local-first software'), true);
  assert.deepEqual(localFirst.preferredFormats, ['talk']);
  assert.equal(neutral.goal, 'Distributed systems');
  assert.deepEqual(neutral.intents, []);
  assert.equal(base.goal, 'Distributed systems');
});


test('durable mode retrieval is driven by weighted canonical members and changes query plans', () => {
  const base = {
    goal: 'Personal recommendations',
    language: null,
    explicitTopics: ['Technology'],
    aliases: [],
    intents: [],
    semanticTerms: ['Technology'],
    positiveRuleTerms: [],
    negativeRuleTerms: [],
    preferredFormats: ['guide'],
    creatorTerms: [],
  };
  const mode = {
    id: 'mode:inferred:v1:lofi',
    label: 'chill lofi',
    revision: 4,
    members: [
      {
        canonicalId: 'canonical:lofi-beats',
        label: 'lofi beats',
        weight: 1,
        sourceNodeIds: ['topic:lofi-beats'],
        supportContentIds: ['a', 'b'],
      },
      {
        canonicalId: 'canonical:chill-lofi',
        label: 'chill lofi',
        weight: 0.9,
        sourceNodeIds: ['topic:chill-lofi'],
        supportContentIds: ['a', 'c'],
      },
      {
        canonicalId: 'canonical:lofi-rain',
        label: 'lofi rain ambience',
        weight: 0.7,
        sourceNodeIds: ['topic:lofi-rain'],
        supportContentIds: ['b', 'c'],
      },
    ],
    provenance: 'inferred',
    pipelineId: 'durable-semantic-mode-cluster-v1',
    graphRevision: 12,
    createdAt: '2026-09-28T00:00:00.000Z',
    lastSupportedAt: '2026-09-28T00:00:00.000Z',
    active: true,
    pinned: false,
  };

  const profile = applyDurableModeToRetrievalProfile(base, mode);
  assert.deepEqual(
    profile.explicitTopics.slice(0, 3),
    ['lofi beats', 'chill lofi', 'lofi rain ambience'],
  );
  assert.equal(profile.goal, 'Personal recommendations chill lofi');
  assert.equal(profile.semanticTerms.includes('lofi beats'), true);

  const baselinePlans = buildRecommendationQueryPlans(base, 6, 'graph-12:default');
  const modePlans = buildRecommendationQueryPlans(
    profile,
    6,
    'graph-12:mode-mode:inferred:v1:lofi:r4',
  );
  assert.ok(modePlans.some((plan) => /lofi beats/i.test(plan.text)));
  assert.ok(modePlans.every((plan) => plan.algorithmRevision.includes('r4')));

  const metrics = evaluateRetrievalModeChanges([{
    id: 'durable-lofi',
    baselineQueries: baselinePlans.map((plan) => plan.text),
    modeQueries: modePlans.map((plan) => plan.text),
    expectedChange: true,
  }]);
  assert.equal(metrics.accuracy, 1);
  assert.equal(metrics.observedChangeCount, 1);
});

test('dormant durable mode still changes retrieval intent so acquisition can rebuild supply', () => {
  const base = {
    goal: '',
    language: null,
    explicitTopics: ['General'],
    aliases: [],
    intents: [],
    semanticTerms: ['General'],
    positiveRuleTerms: [],
    negativeRuleTerms: [],
    preferredFormats: ['guide'],
    creatorTerms: [],
  };
  const dormant = {
    id: 'mode:inferred:v1:systems',
    label: 'Distributed systems',
    revision: 7,
    members: [{
      canonicalId: 'canonical:crdts',
      label: 'CRDTs',
      weight: 1,
      sourceNodeIds: ['topic:crdts'],
      supportContentIds: [],
    }],
    provenance: 'inferred',
    pipelineId: 'durable-semantic-mode-cluster-v1',
    graphRevision: 22,
    createdAt: '2026-09-28T00:00:00.000Z',
    lastSupportedAt: '2026-09-28T00:00:00.000Z',
    active: false,
    pinned: false,
  };

  const profile = applyDurableModeToRetrievalProfile(base, dormant);
  assert.equal(profile.explicitTopics[0], 'CRDTs');
  assert.equal(profile.goal, 'Distributed systems');
  assert.ok(
    buildRecommendationQueryPlans(profile, 4, 'graph-22:mode-systems-r7')
      .some((plan) => /crdts/i.test(plan.text)),
  );
});


test('semantic mode profile selects graph nodes from embedding similarities', () => {
  const semanticState = {
    schemaVersion: 2,
    evidence: [],
    graph: {
      nodes: [
        { id: 'objective:ship', kind: 'objective', label: 'Ship reliable software', provenance: 'explicit', confidence: 1, attributes: {}, createdAt: 'x', updatedAt: 'x' },
        { id: 'topic:systems', kind: 'topic', label: 'Distributed systems', provenance: 'explicit', confidence: 0.9, attributes: {}, createdAt: 'x', updatedAt: 'x' },
        { id: 'concept:music', kind: 'concept', label: 'Ambient music', provenance: 'inferred', confidence: 0.8, attributes: {}, createdAt: 'x', updatedAt: 'x' },
      ],
      edges: [],
      userEdits: [],
      revisions: [],
      currentRevision: 7,
    },
  };

  const profile = buildSemanticModeProfile(semanticState, 'Distributed systems', {
    'objective:ship': 0.92,
    'topic:systems': 0.81,
    'concept:music': 0.05,
  });

  assert.equal(profile.graph_revision, 7);
  assert.equal(profile.semantic_terms.includes('Ship reliable software'), true);
  assert.equal(profile.semantic_terms.includes('Distributed systems'), true);
  assert.equal(profile.semantic_terms.includes('Ambient music'), false);
  assert.equal(profile.node_weights['objective:ship'], 1);
  assert.equal(profile.seed_text, 'Distributed systems');
});

test('embedding helpers normalize centroid and cosine similarity', () => {
  const centroid = weightedEmbeddingCentroid([
    { embedding: [1, 0], weight: 2 },
    { embedding: [0, 1], weight: 1 },
  ]);
  assert.ok(Math.abs(Math.hypot(...centroid) - 1) < 1e-9);
  assert.ok(cosineSimilarity(centroid, [1, 0]) > cosineSimilarity(centroid, [0, 1]));
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(semanticModeSeed('Local-first software'), 'Local-first software');
});
