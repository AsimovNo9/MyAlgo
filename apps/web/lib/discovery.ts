import type { Algorithm } from '@repo/shared-types';

import { buildRecommendationProfile, buildRecommendationQueryPlans } from './recommendation-profile.ts';
import type { ConceptCatalogEntry, ConceptRelationEntry } from './concepts.ts';

const MAX_DISCOVERY_QUERIES = 5;

export function buildDiscoveryQueries(algorithm?: Algorithm | null): string[] {
  return buildDiscoveryQueryPlans(algorithm).map((query) => query.text);
}

export function buildDiscoveryQueryPlans(algorithm?: Algorithm | null, catalog: ConceptCatalogEntry[] = [], relations: ConceptRelationEntry[] = []) {
  const profile = buildRecommendationProfile(algorithm, catalog);
  const algorithmRevision = algorithm?.id ?? algorithm?.name.trim().toLowerCase() ?? 'current';
  return buildRecommendationQueryPlans(profile, MAX_DISCOVERY_QUERIES, algorithmRevision, catalog, relations);
}

export const discoveryLimits = {
  maxQueriesPerSync: MAX_DISCOVERY_QUERIES,
  maxResultsPerQuery: 5,
};
