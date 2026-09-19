import type { Algorithm } from '@repo/shared-types';

const MAX_DISCOVERY_QUERIES = 5;

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
  const learningIntent = /learn|course|lecture|tutorial|study|education|university|lesson/i.test(`${goal} ${ruleTerms.join(' ')}`);
  const formatTerms = learningIntent
    ? ['tutorial', 'lecture', 'university course', 'explainer']
    : ['tutorial', 'guide', 'explainer'];
  const queries = [
    goal,
    topics.slice(0, 2).join(' '),
    ...formatTerms.map((format) => primaryTopic ? `${primaryTopic} ${format}` : ''),
    ruleTerms[0] ?? '',
  ];

  return [...new Set(queries.map((query) => query.replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .slice(0, MAX_DISCOVERY_QUERIES);
}

export const discoveryLimits = {
  maxQueriesPerSync: MAX_DISCOVERY_QUERIES,
  maxResultsPerQuery: 5,
};
