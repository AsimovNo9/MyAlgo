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

export interface PersistedAlgorithmIntentProfile {
  canonical_topics?: string[] | null;
  aliases?: string[] | null;
  intents?: string[] | null;
  semantic_terms?: string[] | null;
}

export interface ConceptsApiAlgorithmRecord {
  id: string;
  name: string;
  goal_text?: string | null;
  topic_weights?: Array<{ topic: string; weight: number }>;
  algorithm_intent_profiles?: PersistedAlgorithmIntentProfile[] | null;
}

export interface ConceptCatalogEntry {
  id: string;
  canonicalName: string;
  aliases: string[];
  intents: string[];
}

export function buildConceptCatalog(
  entries: Array<{
    id: string;
    canonical_name: string;
    aliases?: string[] | null;
    intents?: string[] | null;
  }>,
): ConceptCatalogEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    canonicalName: entry.canonical_name,
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    intents: Array.isArray(entry.intents) ? entry.intents : [],
  }));
}

function normalizeStringList(values?: string[] | null): string[] {
  return Array.isArray(values) ? values : [];
}

export function normalizeAlgorithmIntentProfile(profile?: PersistedAlgorithmIntentProfile | null): AlgorithmIntentProfile {
  return {
    canonicalTopics: normalizeStringList(profile?.canonical_topics),
    aliases: normalizeStringList(profile?.aliases),
    intents: normalizeStringList(profile?.intents),
    semanticTerms: normalizeStringList(profile?.semantic_terms),
  };
}

function mergePersistedAlgorithmIntentProfiles(profiles: PersistedAlgorithmIntentProfile[]): AlgorithmIntentProfile {
  const canonicalTopics = new Set<string>();
  const aliases = new Set<string>();
  const intents = new Set<string>();
  const semanticTerms = new Set<string>();

  for (const profile of profiles) {
    const normalized = normalizeAlgorithmIntentProfile(profile);
    normalized.canonicalTopics.forEach((topic) => canonicalTopics.add(topic));
    normalized.aliases.forEach((alias) => aliases.add(alias));
    normalized.intents.forEach((intent) => intents.add(intent));
    normalized.semanticTerms.forEach((term) => semanticTerms.add(term));
  }

  return {
    canonicalTopics: [...canonicalTopics],
    aliases: [...aliases],
    intents: [...intents],
    semanticTerms: [...semanticTerms],
  };
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

export function buildStoredOrDerivedAlgorithmIntentProfile(
  algorithm?: ConceptsApiAlgorithmRecord | null,
): AlgorithmIntentProfile {
  const persistedProfiles = Array.isArray(algorithm?.algorithm_intent_profiles)
    ? algorithm.algorithm_intent_profiles.filter(Boolean)
    : [];

  if (!algorithm) {
    return buildAlgorithmIntentProfile(null);
  }

  return persistedProfiles.length > 0
    ? mergePersistedAlgorithmIntentProfiles(persistedProfiles)
    : buildAlgorithmIntentProfile({
      id: algorithm.id,
      name: algorithm.name,
      goal_text: algorithm.goal_text ?? null,
      topic_weights: (algorithm.topic_weights ?? []).map((item) => ({ topic: item.topic, weight: item.weight })),
    });
}

export function buildConceptsApiResponse({
  conceptEntries,
  algorithms,
}: {
  conceptEntries: Array<{
    id: string;
    canonical_name: string;
    aliases?: string[] | null;
    intents?: string[] | null;
  }>;
  algorithms: ConceptsApiAlgorithmRecord[];
}) {
  return {
    concepts: buildConceptCatalog(conceptEntries),
    profiles: algorithms.map((algorithm) => ({
      algorithmId: algorithm.id,
      name: algorithm.name,
      profile: buildStoredOrDerivedAlgorithmIntentProfile({
        ...algorithm,
        goal_text: algorithm.goal_text ?? null,
        topic_weights: (algorithm.topic_weights ?? []).map((item) => ({ topic: item.topic, weight: item.weight })),
      }),
    })),
  };
}
