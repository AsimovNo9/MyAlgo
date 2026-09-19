import type { Algorithm } from '@repo/shared-types';

import { resolveTopicConceptTerms } from './concepts.ts';

const MAX_DISCOVERY_QUERIES = 5;

function buildConceptAliasQueries(topic: string, goal: string): string[] {
  const normalized = topic.trim();
  if (!normalized) {
    return [];
  }

  const lower = normalized.toLowerCase();
  const shouldUseAliasExpansion = /\b(game|gaming|esports|design|ux design|product design)\b/.test(lower);
  if (!shouldUseAliasExpansion) {
    return [];
  }

  const aliasTerms = resolveTopicConceptTerms(normalized, goal);
  return aliasTerms.filter((term) => term.toLowerCase() !== normalized.toLowerCase());
}

export function buildDiscoveryQueries(algorithm?: Algorithm | null): string[] {
  if (!algorithm) {
    return [];
  }

  const topics = (algorithm.topic_weights ?? [])
    .filter((item) => item.weight >= 55 && item.topic.trim().length > 0)
    .sort((left, right) => right.weight - left.weight)
    .map((item) => item.topic.trim());
  const goal = algorithm.goal_text?.trim() ?? '';
  const ruleTerms = (algorithm.rules ?? [])
    .filter((rule) => rule.type !== 'never_show' && rule.condition_text.trim().length > 0)
    .map((rule) => rule.condition_text.trim());

  const primaryTopic = topics[0] ?? '';
  const conceptAliasQueries = buildConceptAliasQueries(primaryTopic, goal);
  const learningIntent = /learn|course|lecture|tutorial|study|education|university|lesson/i.test(`${goal} ${ruleTerms.join(' ')}`);
  const formatTerms = learningIntent
    ? ['tutorial', 'lecture', 'university course', 'explainer']
    : ['tutorial', 'guide', 'explainer'];
  const shouldPromoteRuleTerm = !!ruleTerms[0] && /\b(game|gaming|esports|design)\b/i.test(primaryTopic || '') && !/\b(game|gaming|esports)\b/i.test(ruleTerms[0]);
  const queries = [
    goal,
    topics.slice(0, 2).join(' '),
    ...(shouldPromoteRuleTerm ? ruleTerms.slice(0, 1) : []),
    ...conceptAliasQueries,
    ...formatTerms.map((format) => primaryTopic ? `${primaryTopic} ${format}` : ''),
  ];

  return [...new Set(queries.map((query) => query.replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .slice(0, MAX_DISCOVERY_QUERIES);
}

export const discoveryLimits = {
  maxQueriesPerSync: MAX_DISCOVERY_QUERIES,
  maxResultsPerQuery: 5,
};
