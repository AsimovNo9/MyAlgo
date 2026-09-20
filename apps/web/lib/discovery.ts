import type { Algorithm } from '@repo/shared-types';

import { buildRecommendationProfile, buildRecommendationQueryPlans } from './recommendation-profile.ts';
import type { ConceptCatalogEntry, ConceptRelationEntry } from './concepts.ts';

const MAX_DISCOVERY_QUERIES = 5;
const DEFAULT_MAX_RESULTS_PER_QUERY = 5;
const MAX_RESULTS_PER_QUERY = 50;

export function buildDiscoveryQueries(algorithm?: Algorithm | null): string[] {
  return buildDiscoveryQueryPlans(algorithm).map((query) => query.text);
}

export function buildDiscoveryQueryPlans(algorithm?: Algorithm | null, catalog: ConceptCatalogEntry[] = [], relations: ConceptRelationEntry[] = [], learnedCreatorTerms: string[] = []) {
  const profile = buildRecommendationProfile(algorithm, catalog, learnedCreatorTerms);
  const algorithmRevision = algorithm?.id ?? algorithm?.name.trim().toLowerCase() ?? 'current';
  return buildRecommendationQueryPlans(profile, MAX_DISCOVERY_QUERIES, algorithmRevision, catalog, relations, true);
}

export const discoveryLimits = {
  maxQueriesPerSync: MAX_DISCOVERY_QUERIES,
  maxResultsPerQuery: DEFAULT_MAX_RESULTS_PER_QUERY,
};

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function getDiscoveryLimits() {
  return {
    maxQueriesPerSync: MAX_DISCOVERY_QUERIES,
    maxResultsPerQuery: boundedInteger(
      process.env.YOUTUBE_DISCOVERY_MAX_RESULTS_PER_QUERY,
      DEFAULT_MAX_RESULTS_PER_QUERY,
      1,
      MAX_RESULTS_PER_QUERY,
    ),
  };
}
