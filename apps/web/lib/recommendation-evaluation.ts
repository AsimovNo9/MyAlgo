export type EvaluationFixtureKind =
  | 'direct'
  | 'adjacent'
  | 'negative'
  | 'ambiguous'
  | 'language'
  | 'watched'
  | 'duplicate'
  | 'replacement';

export type EvaluationCandidate = {
  id: string;
  kind: EvaluationFixtureKind;
  relevant: boolean;
  conceptIds: string[];
  channelId: string;
  isNew: boolean;
};

export type RecommendationEvaluationInput = {
  candidates: EvaluationCandidate[];
  rankedIds: string[];
  expectedConceptIds: string[];
  excludedIds: string[];
  rejectedNativeSlots: number;
  replacementIds: string[];
  correctionIds: string[];
};

export type RecommendationEvaluationMetrics = {
  relevantAtK: number;
  falsePositiveRate: number;
  conceptCoverage: number;
  novelty: number;
  diversity: number;
  replacementSuccess: number;
  correctionRate: number;
};

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

export function evaluateRecommendation(
  input: RecommendationEvaluationInput,
  k = 10,
): RecommendationEvaluationMetrics {
  const byId = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));
  const topIds = input.rankedIds.slice(0, Math.max(0, k));
  const topCandidates = topIds.map((id) => byId.get(id)).filter((candidate): candidate is EvaluationCandidate => Boolean(candidate));
  const relevantCount = topCandidates.filter((candidate) => candidate.relevant).length;
  const matchedConcepts = new Set(topCandidates.flatMap((candidate) => candidate.conceptIds));
  const channels = new Set(topCandidates.map((candidate) => candidate.channelId).filter(Boolean));
  const excluded = new Set(input.excludedIds);
  const corrections = new Set(input.correctionIds);
  const invalidCount = topIds.filter((id) => excluded.has(id)).length;

  return {
    relevantAtK: ratio(relevantCount, Math.min(k, input.expectedConceptIds.length > 0 ? Math.max(1, topCandidates.length) : Math.max(1, k))),
    falsePositiveRate: ratio(topCandidates.filter((candidate) => !candidate.relevant).length, topCandidates.length),
    conceptCoverage: ratio(input.expectedConceptIds.filter((conceptId) => matchedConcepts.has(conceptId)).length, input.expectedConceptIds.length),
    novelty: ratio(topCandidates.filter((candidate) => candidate.isNew).length, topCandidates.length),
    diversity: ratio(channels.size, topCandidates.length),
    replacementSuccess: ratio(input.replacementIds.length, input.rejectedNativeSlots),
    correctionRate: ratio([...corrections].filter((id) => !topIds.includes(id)).length - invalidCount, corrections.size),
  };
}

export const recommendationEvaluationFixtures: EvaluationCandidate[] = [
  { id: 'direct-rpg', kind: 'direct', relevant: true, conceptIds: ['rpg', 'gaming'], channelId: 'channel-a', isNew: true },
  { id: 'adjacent-design', kind: 'adjacent', relevant: true, conceptIds: ['game-design'], channelId: 'channel-b', isNew: true },
  { id: 'negative-gacha', kind: 'negative', relevant: false, conceptIds: ['mobile-gaming', 'gacha'], channelId: 'channel-c', isNew: true },
  { id: 'ambiguous-review', kind: 'ambiguous', relevant: false, conceptIds: ['review'], channelId: 'channel-d', isNew: true },
  { id: 'language-ja', kind: 'language', relevant: false, conceptIds: ['rpg'], channelId: 'channel-e', isNew: true },
  { id: 'watched-rpg', kind: 'watched', relevant: false, conceptIds: ['rpg'], channelId: 'channel-a', isNew: false },
  { id: 'duplicate-rpg', kind: 'duplicate', relevant: true, conceptIds: ['rpg'], channelId: 'channel-a', isNew: false },
  { id: 'replacement-rpg', kind: 'replacement', relevant: true, conceptIds: ['rpg', 'gaming'], channelId: 'channel-f', isNew: true },
];