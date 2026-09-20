import type { Algorithm, RecommendationProfile as SharedRecommendationProfile, RecommendationQuery, RecommendationQueryPlan, RecommendationQueryLane } from '@repo/shared-types';

import { buildAlgorithmIntentProfile, resolveTopicConceptTerms, type ConceptCatalogEntry, type ConceptRelationEntry } from './concepts.ts';

export type RecommendationProfile = SharedRecommendationProfile & {
  goal: string;
  language: string | null;
  explicitTopics: string[];
  aliases: string[];
  intents: string[];
  semanticTerms: string[];
  positiveRuleTerms: string[];
  negativeRuleTerms: string[];
  preferredFormats: string[];
};

export type { RecommendationQuery, RecommendationQueryLane, RecommendationQueryPlan } from '@repo/shared-types';

const defaultQueryLimit = 5;

export function buildRecommendationQueryPlans(
  profile: RecommendationProfile,
  limit = defaultQueryLimit,
  algorithmRevision = 'current',
  catalog: ConceptCatalogEntry[] = [],
  relations: ConceptRelationEntry[] = [],
  includeFreshness = false,
): RecommendationQueryPlan[] {
  return buildRecommendationQueries(profile, limit, catalog, relations, includeFreshness).map((query) => ({
    ...query,
    algorithmRevision,
  }));
}

function inferPreferredFormats(goal: string, positiveRuleTerms: string[]): string[] {
  const text = `${goal} ${positiveRuleTerms.join(' ')}`;
  return /learn|course|lecture|tutorial|study|education|university|lesson/i.test(text)
    ? ['tutorial']
    : ['guide'];
}

function normalizeLanguage(language?: string | null): string | null {
  const normalized = language?.trim().toLowerCase() ?? '';
  return /^[a-z]{2}$/.test(normalized) ? normalized : null;
}

function normalizeFormats(formats?: string[]): string[] {
  return [...new Set((formats ?? []).map((format) => format.trim().toLowerCase()).filter(Boolean))];
}

export function buildRecommendationProfile(algorithm?: Algorithm | null, catalog: ConceptCatalogEntry[] = [], learnedCreatorTerms: string[] = []): RecommendationProfile {
  const intentProfile = buildAlgorithmIntentProfile(algorithm, catalog);
  const rules = algorithm?.rules ?? [];
  const positiveRuleTerms = rules
    .filter((rule) => rule.type !== 'never_show' && rule.condition_text.trim().length > 0)
    .map((rule) => rule.condition_text.trim());
  const creatorTerms = positiveRuleTerms
    .map((term) => term.match(/^(?:creator|channel)\s*:\s*(.+)$/i)?.[1]?.trim() ?? '')
    .filter(Boolean);
  const negativeRuleTerms = rules
    .filter((rule) => rule.type === 'never_show' && rule.condition_text.trim().length > 0)
    .map((rule) => rule.condition_text.trim());
  const goal = algorithm?.goal_text?.trim() ?? '';
  const explicitFormats = normalizeFormats(algorithm?.preferred_formats);

  return {
    goal,
    language: normalizeLanguage(algorithm?.language),
    explicitTopics: intentProfile.canonicalTopics,
    aliases: intentProfile.aliases,
    intents: intentProfile.intents,
    semanticTerms: intentProfile.semanticTerms,
    positiveRuleTerms,
    negativeRuleTerms,
    preferredFormats: explicitFormats.length > 0 ? explicitFormats : inferPreferredFormats(goal, positiveRuleTerms),
    creatorTerms: [...new Set([...creatorTerms, ...learnedCreatorTerms])],
  };
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildTopicQueries(profile: RecommendationProfile, topic: string, catalog: ConceptCatalogEntry[] = []): RecommendationQuery[] {
  const lowerTopic = topic.toLowerCase();
  const supportsAliasExpansion = /\b(game|gaming|esports|design|ux design|product design)\b/.test(lowerTopic);
  const terms = resolveTopicConceptTerms(topic, profile.goal, catalog)
    .filter((term) => term.toLowerCase() !== lowerTopic);
  const ruleAliases = terms.filter((term) => profile.positiveRuleTerms.some((rule) => rule.toLowerCase() === term.toLowerCase()));
  const aliasTerms = supportsAliasExpansion ? [...new Set([...ruleAliases, ...terms])] : [];

  return [
    ...aliasTerms.map((term) => ({ text: term, lane: 'alias' as const, topics: [topic] })),
    ...profile.preferredFormats.map((format) => ({
      text: `${topic} ${format}`,
      lane: 'format' as const,
      topics: [topic],
    })),
  ];
}

function buildGraphQueries(
  profile: RecommendationProfile,
  catalog: ConceptCatalogEntry[],
  relations: ConceptRelationEntry[],
): RecommendationQuery[] {
  if (catalog.length === 0 || relations.length === 0) return [];

  const strongConcepts = profile.explicitTopics
    .map((topic) => {
      const normalized = topic.trim().toLowerCase();
      return catalog.find((concept) => concept.canonicalName.trim().toLowerCase() === normalized);
    })
    .filter((concept): concept is ConceptCatalogEntry => Boolean(concept));
  const strongIds = new Set(strongConcepts.map((concept) => concept.id));
  const allowedRelations = new Set(['parent_of', 'child_of', 'related_to', 'example_of', 'often_cooccurs_with', 'format_for']);

  return relations
    .filter((relation) => strongIds.has(relation.source_concept_id) && allowedRelations.has(relation.relation_type) && relation.weight >= 0.5)
    .sort((left, right) => right.weight - left.weight)
    .flatMap((relation) => {
      const source = catalog.find((concept) => concept.id === relation.source_concept_id);
      const target = catalog.find((concept) => concept.id === relation.target_concept_id);
      if (!source || !target) return [];
      return [{
        text: `${target.canonicalName} ${profile.preferredFormats[0] ?? ''}`.trim(),
        lane: 'intent' as const,
        topics: [source.canonicalName, target.canonicalName],
      }];
    });
}

export function buildRecommendationQueries(
  profile: RecommendationProfile,
  limit = defaultQueryLimit,
  catalog: ConceptCatalogEntry[] = [],
  relations: ConceptRelationEntry[] = [],
  includeFreshness = false,
): RecommendationQuery[] {
  if (limit <= 0 || profile.explicitTopics.length === 0) {
    return [];
  }

  const freshnessQueries = includeFreshness
    ? profile.explicitTopics.slice(0, 1).map((topic) => ({
      text: `${topic} latest`,
      lane: 'freshness' as const,
      topics: [topic],
    }))
    : [];
  const planningLimit = Math.max(1, limit - freshnessQueries.length);
  const planned: RecommendationQuery[] = [];
  if (profile.goal) {
    planned.push({ text: profile.goal, lane: 'goal', topics: profile.explicitTopics });
  }

  planned.push(...profile.creatorTerms.map((creator) => ({
    text: `${creator} ${profile.preferredFormats[0] ?? ''}`.trim(),
    lane: 'creator' as const,
    topics: [],
  })));

  planned.push(...buildGraphQueries(profile, catalog, relations));

  const queriesByTopic = profile.explicitTopics.map((topic) => buildTopicQueries(profile, topic, catalog));
  const cursors = new Array(queriesByTopic.length).fill(0);
  let hasMore = true;

  while (planned.length < planningLimit && hasMore) {
    hasMore = false;
    for (let topicIndex = 0; topicIndex < queriesByTopic.length && planned.length < planningLimit; topicIndex += 1) {
      const topicQueries = queriesByTopic[topicIndex];
      const cursor = cursors[topicIndex];
      if (cursor >= topicQueries.length) {
        continue;
      }

      cursors[topicIndex] += 1;
      planned.push(topicQueries[cursor]);
      hasMore = true;
    }
  }

  planned.push(...freshnessQueries);

  const seen = new Set<string>();
  return planned.filter((query) => {
    const text = normalizeQuery(query.text);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) {
      return false;
    }

    seen.add(key);
    query.text = text;
    return true;
  }).slice(0, limit);
}