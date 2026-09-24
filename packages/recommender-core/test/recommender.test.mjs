import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPreferenceSignal,
  buildCandidateMetadataEnrichment,
  buildConceptExpansion,
  buildPreferenceModel,
  buildPreferenceSummary,
  buildRecommendationExplanation,
  buildRecommendationLabSummary,
  buildRecommendationProfile,
  buildRecommendationQueries,
  buildRecommendationTrace,
  decayPreferenceModel,
  evaluateLocalFirstIntelligenceBenchmark,
  exportPreferenceModel,
  getPreferenceScore,
  replayRecommendationTrace,
  resetPreferenceModel,
} from '../src/index.ts';

test('buildRecommendationProfile separates positive and negative rules', () => {
  const profile = buildRecommendationProfile({
    name: 'Gaming',
    goal_text: 'Learn Nintendo RPG design',
    topic_weights: [{ topic: 'Gaming', weight: 90 }, { topic: 'RPG', weight: 80 }, { topic: 'News', weight: 20 }],
    rules: [
      { type: 'priority', condition_text: 'developer commentary' },
      { type: 'never_show', condition_text: 'celebrity gossip' },
    ],
  });

  assert.deepEqual(profile.explicitTopics, ['Gaming', 'RPG']);
  assert.deepEqual(profile.positiveRuleTerms, ['developer commentary']);
  assert.deepEqual(profile.negativeRuleTerms, ['celebrity gossip']);
  assert.deepEqual(profile.preferredFormats, ['tutorial']);
  assert.equal(profile.semanticTerms.includes('game design'), true);
});

test('buildRecommendationQueries is bounded, round-robin, and deduplicated', () => {
  const profile = buildRecommendationProfile({
    name: 'Gaming',
    goal_text: 'Nintendo RPGs',
    topic_weights: [
      { topic: 'Gaming', weight: 90 },
      { topic: 'Engineering', weight: 85 },
      { topic: 'RPG', weight: 80 },
    ],
    rules: [],
  });

  const queries = buildRecommendationQueries(profile, 4);

  assert.equal(queries[0].text, 'Nintendo RPGs');
  assert.equal(queries.some((query) => query.text === 'Gaming guide'), true);
  assert.equal(queries.some((query) => query.text === 'Engineering guide'), true);
  assert.equal(queries.some((query) => query.text === 'RPG guide'), true);
  assert.equal(new Set(queries.map((query) => query.text.toLowerCase())).size, queries.length);
});

test('buildConceptExpansion expands a topic through aliases and related concept graph edges', () => {
  const catalog = [
    { id: 'game-design', canonicalName: 'Game Design', aliases: ['game design'], intents: ['gameplay systems'], version: 3 },
    { id: 'rpg', canonicalName: 'RPG', aliases: ['role playing games'], intents: ['narrative systems'], version: 2 },
  ];
  const relations = [
    { source_concept_id: 'game-design', target_concept_id: 'rpg', relation_type: 'related_to', weight: 0.89 },
  ];

  const expansion = buildConceptExpansion('Gaming', catalog, relations);

  assert.equal(expansion.canonicalName, 'Gaming');
  assert.equal(expansion.aliases.includes('game design'), true);
  assert.equal(expansion.relatedConcepts.includes('rpg'), true);
  assert.equal(expansion.version, 3);
});

test('buildCandidateMetadataEnrichment adds normalized topic metadata and policy metadata', () => {
  const enrichment = buildCandidateMetadataEnrichment({
    title: 'Indie RPG design: combat and progression',
    description: 'A breakdown of valuable systems for game design',
    creator: 'FromSoftware',
    durationSeconds: 1250,
    language: 'en',
    topics: ['Game Design', 'RPG'],
  }, [
    { id: 'game-design', canonicalName: 'Game Design', aliases: ['game design'], intents: ['combat systems'], version: 3 },
    { id: 'rpg', canonicalName: 'RPG', aliases: ['role playing games'], intents: ['progression'], version: 2 },
  ]);

  assert.equal(enrichment.title, 'Indie RPG design: combat and progression');
  assert.equal(enrichment.creator, 'FromSoftware');
  assert.equal(enrichment.concepts.includes('game design'), true);
  assert.equal(enrichment.policy.allowed, true);
  assert.equal(Array.isArray(enrichment.policy.reasons), true);
  assert.equal(enrichment.metadata.language, 'en');
});

test('preference model keeps explicit signals authoritative while learned signals accumulate', () => {
  const model = buildPreferenceModel();

  applyPreferenceSignal(model, { namespace: 'learned', key: 'rpg', value: 0.8, confidence: 0.7, evidence: 2, source: 'feedback' });
  applyPreferenceSignal(model, { namespace: 'explicit', key: 'rpg', value: 0.95, confidence: 1, evidence: 5, source: 'user_override' });

  assert.equal(getPreferenceScore(model, 'rpg'), 0.95);
  assert.equal(model.explicit.get('rpg'), 0.95);
  assert.equal(model.learned.get('rpg') > 0.5, true);
});

test('decayPreferenceModel reduces stale learned signals and reset/export preserve the model contract', () => {
  const model = buildPreferenceModel();

  applyPreferenceSignal(model, { namespace: 'learned', key: 'ai', value: 0.9, confidence: 0.8, evidence: 3, source: 'activity' });
  decayPreferenceModel(model, 0.5);
  const snapshot = exportPreferenceModel(model);
  const original = resetPreferenceModel(model);

  assert.equal(snapshot.learned.ai > 0, true);
  assert.equal(snapshot.learned.ai < 0.9, true);
  assert.deepEqual(original.learned, {});
  assert.deepEqual(original.explicit, {});
  assert.deepEqual(original.contextual, {});
});

test('buildPreferenceSummary and buildRecommendationExplanation produce stable explainability without raw internals', () => {
  const model = buildPreferenceModel();
  applyPreferenceSignal(model, { namespace: 'explicit', key: 'rpg', value: 0.9, confidence: 0.95, evidence: 4, source: 'user_override' });
  applyPreferenceSignal(model, { namespace: 'learned', key: 'game design', value: 0.75, confidence: 0.8, evidence: 3, source: 'feedback' });

  const summary = buildPreferenceSummary(model);
  const explanation = buildRecommendationExplanation({
    topic: 'RPG',
    lane: 'topic',
    traceId: 'trace-123',
    model,
    reasonCode: 'explicit_topic',
    candidateSummary: 'Indie RPG design breakdown',
  });

  assert.equal(summary.interests.some((interest) => interest.key === 'rpg'), true);
  assert.equal(explanation.id.startsWith('exp-'), true);
  assert.equal(explanation.traceId, 'trace-123');
  assert.equal(explanation.summary.includes('RPG'), true);
  assert.equal(explanation.summary.toLowerCase().includes('embedding'), false);
  assert.equal(explanation.reasonCode, 'explicit_topic');
});

test('evaluateLocalFirstIntelligenceBenchmark marks local-first ready only when quality and latency clear the gate', () => {
  const ready = evaluateLocalFirstIntelligenceBenchmark({
    precision: 0.81,
    recall: 0.78,
    f1: 0.79,
    latencyMs: 180,
    memoryMb: 220,
    multilingualCoverage: 0.88,
  });

  const fallback = evaluateLocalFirstIntelligenceBenchmark({
    precision: 0.58,
    recall: 0.6,
    f1: 0.59,
    latencyMs: 520,
    memoryMb: 520,
    multilingualCoverage: 0.52,
  });

  assert.equal(ready.localPathReady, true);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.cloudFallbackAllowed, false);
  assert.equal(fallback.status, 'needs_benchmark');
  assert.equal(fallback.cloudFallbackAllowed, true);
});

test('buildRecommendationTrace and replayRecommendationTrace create stable trace metadata and counterfactual deltas', () => {
  const trace = buildRecommendationTrace({
    userId: 'u-123',
    candidateId: 'c-999',
    retrievalLane: 'topic',
    score: 0.91,
    explanation: 'Strong RPG match',
    reasonCode: 'explicit_topic',
  });

  const replay = replayRecommendationTrace({
    trace,
    baselineScore: 0.91,
    counterfactualScore: 0.76,
    observedOutcome: 'click',
  });

  assert.equal(trace.id.startsWith('trace-'), true);
  assert.equal(trace.retrievalLane, 'topic');
  assert.equal(trace.reasonCode, 'explicit_topic');
  assert.equal(replay.status, 'regressed');
  assert.equal(replay.delta < 0, true);
  assert.equal(replay.counterfactualScore, 0.76);
});

test('buildRecommendationLabSummary computes top-k quality and regression metrics from replay rows', () => {
  const summary = buildRecommendationLabSummary([
    { itemId: 'a', rank: 1, score: 0.91, relevant: true, interest: 'rpg' },
    { itemId: 'b', rank: 2, score: 0.65, relevant: false, interest: 'rpg' },
    { itemId: 'c', rank: 3, score: 0.8, relevant: true, interest: 'ai' },
  ], 2);

  assert.equal(summary.relevantAtK, 1);
  assert.equal(summary.precisionAtK > 0.45, true);
  assert.equal(summary.falsePositiveRate > 0, true);
  assert.equal(summary.coverage >= 0.5, true);
});
