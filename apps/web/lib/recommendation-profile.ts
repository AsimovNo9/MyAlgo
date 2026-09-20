import type { Algorithm } from '@repo/shared-types';

import { buildAlgorithmIntentProfile, resolveTopicConceptTerms } from './concepts.ts';

export type RecommendationProfile = {
  goal: string;
  explicitTopics: string[];
  aliases: string[];
  intents: string[];
  semanticTerms: string[];
  positiveRuleTerms: string[];
  negativeRuleTerms: string[];
  preferredFormats: string[];
};

export type RecommendationQueryLane = 'goal' | 'topic' | 'alias' | 'format';

export type RecommendationQuery = {
  text: string;
  lane: RecommendationQueryLane;
  topics: string[];
};

const defaultQueryLimit = 5;

function inferPreferredFormats(goal: string, positiveRuleTerms: string[]): string[] {
  const text = `${goal} ${positiveRuleTerms.join(' ')}`;
  return /learn|course|lecture|tutorial|study|education|university|lesson/i.test(text)
    ? ['tutorial']
    : ['guide'];
}

export function buildRecommendationProfile(algorithm?: Algorithm | null): RecommendationProfile {
  const intentProfile = buildAlgorithmIntentProfile(algorithm);
  const rules = algorithm?.rules ?? [];
  const positiveRuleTerms = rules
    .filter((rule) => rule.type !== 'never_show' && rule.condition_text.trim().length > 0)
    .map((rule) => rule.condition_text.trim());
  const negativeRuleTerms = rules
    .filter((rule) => rule.type === 'never_show' && rule.condition_text.trim().length > 0)
    .map((rule) => rule.condition_text.trim());
  const goal = algorithm?.goal_text?.trim() ?? '';

  return {
    goal,
    explicitTopics: intentProfile.canonicalTopics,
    aliases: intentProfile.aliases,
    intents: intentProfile.intents,
    semanticTerms: intentProfile.semanticTerms,
    positiveRuleTerms,
    negativeRuleTerms,
    preferredFormats: inferPreferredFormats(goal, positiveRuleTerms),
  };
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildTopicQueries(profile: RecommendationProfile, topic: string): RecommendationQuery[] {
  const lowerTopic = topic.toLowerCase();
  const supportsAliasExpansion = /\b(game|gaming|esports|design|ux design|product design)\b/.test(lowerTopic);
  const terms = resolveTopicConceptTerms(topic, profile.goal)
    .filter((term) => term.toLowerCase() !== lowerTopic);
  const ruleAliases = terms.filter((term) => profile.positiveRuleTerms.some((rule) => rule.toLowerCase() === term.toLowerCase()));
  const aliasTerms = supportsAliasExpansion ? [...new Set([...ruleAliases, ...terms])] : [];

  return [
    ...aliasTerms.map((term) => ({ text: term, lane: 'alias' as const, topics: [topic] })),
    {
      text: `${topic} ${profile.preferredFormats[0] ?? 'guide'}`,
      lane: 'format',
      topics: [topic],
    },
  ];
}

export function buildRecommendationQueries(
  profile: RecommendationProfile,
  limit = defaultQueryLimit,
): RecommendationQuery[] {
  if (limit <= 0 || profile.explicitTopics.length === 0) {
    return [];
  }

  const planned: RecommendationQuery[] = [];
  if (profile.goal) {
    planned.push({ text: profile.goal, lane: 'goal', topics: profile.explicitTopics });
  }

  const queriesByTopic = profile.explicitTopics.map((topic) => buildTopicQueries(profile, topic));
  const cursors = new Array(queriesByTopic.length).fill(0);
  let hasMore = true;

  while (planned.length < limit && hasMore) {
    hasMore = false;
    for (let topicIndex = 0; topicIndex < queriesByTopic.length && planned.length < limit; topicIndex += 1) {
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