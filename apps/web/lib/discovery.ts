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

function buildTopicQueryCandidates(topic: string, ruleTerms: string[], goal: string, formatTerm: string): string[] {
  const aliasQueries = buildConceptAliasQueries(topic, goal);
  if (aliasQueries.length === 0) {
    return [`${topic} ${formatTerm}`];
  }

  const ruleAliasMatches = aliasQueries.filter((alias) => ruleTerms.some((term) => term.toLowerCase() === alias.toLowerCase()));
  const orderedAliases = [...new Set([...ruleAliasMatches, ...aliasQueries])];
  return [...orderedAliases, `${topic} ${formatTerm}`];
}

export function buildDiscoveryQueries(algorithm?: Algorithm | null): string[] {
  if (!algorithm) {
    return [];
  }

  const topics = (algorithm.topic_weights ?? [])
    .filter((item) => item.weight >= 55 && item.topic.trim().length > 0)
    .sort((left, right) => right.weight - left.weight)
    .map((item) => item.topic.trim());

  if (topics.length === 0) {
    return [];
  }

  const goal = algorithm.goal_text?.trim() ?? '';
  const ruleTerms = (algorithm.rules ?? [])
    .filter((rule) => rule.type !== 'never_show' && rule.condition_text.trim().length > 0)
    .map((rule) => rule.condition_text.trim());
  const learningIntent = /learn|course|lecture|tutorial|study|education|university|lesson/i.test(`${goal} ${ruleTerms.join(' ')}`);
  const formatTerm = learningIntent ? 'tutorial' : 'guide';

  const candidatesByTopic = topics.map((topic) => buildTopicQueryCandidates(topic, ruleTerms, goal, formatTerm));
  const cursors = new Array(topics.length).fill(0);
  const queries: string[] = [];
  if (goal) {
    queries.push(goal);
  }

  // Round-robin across every strong topic (not just the highest-weighted one), so a
  // multi-topic algorithm (e.g. AI + Gaming + Computer Vision) discovers content from
  // each of its own topics instead of a single source.
  let hasMore = true;
  while (queries.length < MAX_DISCOVERY_QUERIES && hasMore) {
    hasMore = false;
    for (let topicIndex = 0; topicIndex < topics.length && queries.length < MAX_DISCOVERY_QUERIES; topicIndex += 1) {
      const candidates = candidatesByTopic[topicIndex];
      const cursor = cursors[topicIndex];
      if (cursor >= candidates.length) {
        continue;
      }
      cursors[topicIndex] += 1;
      hasMore = true;
      queries.push(candidates[cursor]);
    }
  }

  return [...new Set(queries.map((query) => query.replace(/\s+/g, ' ').trim()).filter(Boolean))]
    .slice(0, MAX_DISCOVERY_QUERIES);
}

export const discoveryLimits = {
  maxQueriesPerSync: MAX_DISCOVERY_QUERIES,
  maxResultsPerQuery: 5,
};
