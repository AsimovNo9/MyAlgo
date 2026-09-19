import type { Algorithm } from '@repo/shared-types';

export interface ResolvedConcept {
  canonical: string;
  aliases: string[];
  intents: string[];
}

export interface AlgorithmIntentProfile {
  canonicalTopics: string[];
  aliases: string[];
  intents: string[];
  semanticTerms: string[];
}

const conceptMap: Record<string, { aliases: string[]; intents: string[] }> = {
  gaming: {
    aliases: ['game design', 'game development', 'gameplay', 'indie games', 'esports'],
    intents: ['game design', 'gameplay systems', 'game mechanics', 'indie game development'],
  },
  'game design': {
    aliases: ['game design', 'game development', 'gameplay', 'indie games', 'esports'],
    intents: ['game design', 'gameplay systems', 'game mechanics', 'indie game development'],
  },
  ai: {
    aliases: ['llm', 'machine learning', 'generative ai', 'computer vision', 'agents'],
    intents: ['model training', 'ai systems', 'llm workflows', 'agent architecture'],
  },
  'computer vision': {
    aliases: ['cv', 'vision models', 'image recognition', 'visual perception'],
    intents: ['object detection', 'image recognition', 'vision models', 'computer vision systems'],
  },
  productivity: {
    aliases: ['deep work', 'focus', 'workflow systems', 'habits'],
    intents: ['focus systems', 'deep work routines', 'workflow optimization', 'productivity systems'],
  },
  design: {
    aliases: ['ux design', 'product design', 'design systems'],
    intents: ['ux flows', 'design systems', 'product thinking', 'interaction design'],
  },
};

function normalizeTopic(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
}

function matchConceptEntry(key: string) {
  const normalizedKey = normalizeTopic(key);

  for (const [conceptKey, concept] of Object.entries(conceptMap)) {
    const normalizedConceptKey = normalizeTopic(conceptKey);
    const aliasMatches = concept.aliases.some((alias) => normalizeTopic(alias) === normalizedKey);
    const conceptMatches = normalizedConceptKey === normalizedKey;
    const containsMatch = normalizedConceptKey.includes(normalizedKey) || normalizedKey.includes(normalizedConceptKey);

    if (conceptMatches || aliasMatches || containsMatch) {
      return { conceptKey, concept };
    }
  }

  return null;
}

export function resolveTopicConcepts(topic: string): ResolvedConcept {
  const canonical = topic.trim();
  const key = normalizeTopic(canonical);
  const exactMatch = conceptMap[key] ?? null;
  const conceptMatch = exactMatch ? { conceptKey: key, concept: exactMatch } : matchConceptEntry(key);

  if (!conceptMatch) {
    return {
      canonical,
      aliases: [],
      intents: [],
    };
  }

  return {
    canonical,
    aliases: [...new Set(conceptMatch.concept.aliases)],
    intents: [...new Set(conceptMatch.concept.intents)],
  };
}

export function resolveTopicConceptTerms(topic: string, goalText?: string | null): string[] {
  const concept = resolveTopicConcepts(topic);
  const terms = new Set<string>([concept.canonical]);

  for (const alias of concept.aliases) {
    terms.add(alias);
  }

  const goal = (goalText ?? '').trim();
  if (goal) {
    const normalizedGoal = goal.toLowerCase();
    for (const intent of concept.intents) {
      if (normalizedGoal.includes(intent.toLowerCase()) || intent.toLowerCase().includes(normalizedGoal.toLowerCase())) {
        terms.add(intent);
      }
    }
  }

  return [...terms].filter(Boolean);
}

export function buildAlgorithmIntentProfile(algorithm?: Algorithm | null): AlgorithmIntentProfile {
  const canonicalTopics = (algorithm?.topic_weights ?? [])
    .filter((item) => item.weight >= 55 && item.topic.trim().length > 0)
    .sort((left, right) => right.weight - left.weight)
    .map((item) => item.topic.trim());

  const aliases = new Set<string>();
  const intents = new Set<string>();
  const semanticTerms = new Set<string>();

  for (const topic of canonicalTopics) {
    const concept = resolveTopicConcepts(topic);
    for (const alias of concept.aliases) {
      aliases.add(alias);
      semanticTerms.add(alias);
    }
    for (const intent of concept.intents) {
      intents.add(intent);
      semanticTerms.add(intent);
    }
    semanticTerms.add(topic);
  }

  const goal = (algorithm?.goal_text ?? '').trim();
  if (goal) {
    const goalTerms = goal
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 12);

    for (const term of goalTerms) {
      semanticTerms.add(term);
    }
  }

  return {
    canonicalTopics,
    aliases: [...aliases],
    intents: [...intents],
    semanticTerms: [...semanticTerms],
  };
}
