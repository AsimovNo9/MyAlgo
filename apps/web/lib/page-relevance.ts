import { resolveTopicConceptTerms } from './concepts.ts';

const topicAliases: Record<string, RegExp> = {
  gaming: /\b(game|games|gaming|gameplay|playthrough|walkthrough|speedrun|esports|rpg|fps|boss|devlog|xbox|playstation|nintendo|steam|minecraft|fortnite|valorant|elden ring)\b/i,
  sports: /\b(sport|sports|football|soccer|basketball|tennis|nba|nfl|formula 1|f1)\b/i,
  travel: /\b(travel|trip|vacation|tourism|destination|flight|hotel)\b/i,
  nature: /\b(nature|wildlife|animals|landscape|ocean|forest|climate)\b/i,
  science: /\b(science|physics|biology|chemistry|space|astronomy)\b/i,
};

const ignoredRelevanceTerms = new Set(['a', 'an', 'and', 'for', 'from', 'how', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesRelevanceTerm(title: string, term: string): boolean {
  const normalizedTerm = term.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalizedTerm || ignoredRelevanceTerms.has(normalizedTerm) || normalizedTerm.length < 2) return false;
  return new RegExp(`(^|\\s|[^a-z0-9])${escapeRegex(normalizedTerm)}($|\\s|[^a-z0-9])`, 'i').test(title);
}

export function inferPageCandidateTopics(
  title: string,
  algorithmTopics: string[],
  goalText?: string | null,
  semanticTerms: string[] = [],
): string[] {
  return algorithmTopics.filter((topic) => {
    const normalizedTopic = topic.trim().toLowerCase();
    const topicPattern = topicAliases[normalizedTopic] ?? new RegExp(`\\b${escapeRegex(normalizedTopic)}\\b`, 'i');
    const conceptTerms = resolveTopicConceptTerms(topic, goalText);
    return [topic, ...conceptTerms, ...semanticTerms].some((term) => (
      topicPattern.test(title) || matchesRelevanceTerm(title, term)
    ));
  });
}
