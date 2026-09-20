import type { CandidatePoolMetrics } from './candidate-generation.ts';

export type RecommendationQualityMetrics = {
  candidateCount: number;
  uniqueCount: number;
  duplicateRate: number;
  classificationCoverage: number;
  sourceDiversity: number;
  topicCoverage: Record<string, number>;
  freshnessCoverage: number;
};

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

export function buildRecommendationQualityMetrics(
  pool: CandidatePoolMetrics,
  classifiedCount: number,
  freshCount: number,
): RecommendationQualityMetrics {
  return {
    candidateCount: pool.inputCount,
    uniqueCount: pool.uniqueCount,
    duplicateRate: ratio(pool.duplicateCount, pool.inputCount),
    classificationCoverage: ratio(classifiedCount, pool.uniqueCount),
    sourceDiversity: Object.values(pool.sourceCounts).filter((count) => count > 0).length,
    topicCoverage: pool.topicCoverage,
    freshnessCoverage: ratio(freshCount, pool.uniqueCount),
  };
}