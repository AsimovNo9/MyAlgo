import type { Algorithm } from '@repo/shared-types';

import { buildRecommendationProfile, buildRecommendationQueries } from './recommendation-profile.ts';

const MAX_DISCOVERY_QUERIES = 5;

export function buildDiscoveryQueries(algorithm?: Algorithm | null): string[] {
  const profile = buildRecommendationProfile(algorithm);
  return buildRecommendationQueries(profile, MAX_DISCOVERY_QUERIES).map((query) => query.text);
}

export const discoveryLimits = {
  maxQueriesPerSync: MAX_DISCOVERY_QUERIES,
  maxResultsPerQuery: 5,
};
