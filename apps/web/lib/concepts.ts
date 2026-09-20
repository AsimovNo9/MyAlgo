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
  description?: string | null;
  entities?: string[];
  positivePhrases?: string[];
  negativePhrases?: string[];
  language?: string | null;
  source?: string;
  version?: number;
  status?: 'pending' | 'approved' | 'rejected';
}

export interface ConceptRelationEntry {
  source_concept_id: string;
  target_concept_id: string;
  relation_type: 'parent_of' | 'child_of' | 'related_to' | 'alias_of' | 'example_of' | 'contrasts_with' | 'often_cooccurs_with' | 'format_for';
  weight: number;
}

const semanticSources = new Set(['curated', 'platform', 'user', 'content', 'llm']);

function normalizeSemanticList(values: unknown, limit = 50): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))].slice(0, limit);
}

export type SemanticContextUpsert = {
  canonical_name: string;
  aliases: string[];
  intents: string[];
  entities: string[];
  positive_phrases: string[];
  negative_phrases: string[];
  description: string | null;
  language: string | null;
  source: string;
  status: 'pending';
  provenance: Record<string, unknown>;
  version: number;
};

export function normalizeSemanticContextEntry(input: unknown): SemanticContextUpsert | null {
  if (!input || typeof input !== 'object') return null;
  const entry = input as Record<string, unknown>;
  const canonicalName = typeof entry.canonical_name === 'string'
    ? entry.canonical_name.trim()
    : typeof entry.canonicalName === 'string'
      ? entry.canonicalName.trim()
      : '';
  if (!canonicalName) return null;

  const source = typeof entry.source === 'string' && semanticSources.has(entry.source)
    ? entry.source
    : 'llm';
  const versionValue = Number(entry.version);
  const provenance = entry.provenance && typeof entry.provenance === 'object'
    ? entry.provenance as Record<string, unknown>
    : {};

  return {
    canonical_name: canonicalName,
    aliases: normalizeSemanticList(entry.aliases),
    intents: normalizeSemanticList(entry.intents),
    entities: normalizeSemanticList(entry.entities),
    positive_phrases: normalizeSemanticList(entry.positive_phrases ?? entry.positivePhrases),
    negative_phrases: normalizeSemanticList(entry.negative_phrases ?? entry.negativePhrases),
    description: typeof entry.description === 'string' ? entry.description.trim() || null : null,
    language: typeof entry.language === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/i.test(entry.language.trim()) ? entry.language.trim().toLowerCase() : null,
    source,
    status: 'pending',
    provenance,
    version: Number.isInteger(versionValue) && versionValue > 0 ? versionValue : 1,
  };
}

export function buildConceptCatalog(
  entries: Array<{
    id: string;
    canonical_name: string;
    aliases?: string[] | null;
    intents?: string[] | null;
    description?: string | null;
    entities?: string[] | null;
    positive_phrases?: string[] | null;
    negative_phrases?: string[] | null;
    language?: string | null;
    source?: string | null;
    version?: number | null;
    status?: 'pending' | 'approved' | 'rejected' | null;
  }>,
): ConceptCatalogEntry[] {
  return entries.map((entry) => {
    const normalized: ConceptCatalogEntry = {
      id: entry.id,
      canonicalName: entry.canonical_name,
      aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
      intents: Array.isArray(entry.intents) ? entry.intents : [],
    };

    if ('description' in entry) normalized.description = entry.description ?? null;
    if ('entities' in entry) normalized.entities = Array.isArray(entry.entities) ? entry.entities : [];
    if ('positive_phrases' in entry) normalized.positivePhrases = Array.isArray(entry.positive_phrases) ? entry.positive_phrases : [];
    if ('negative_phrases' in entry) normalized.negativePhrases = Array.isArray(entry.negative_phrases) ? entry.negative_phrases : [];
    if ('language' in entry) normalized.language = entry.language ?? null;
    if ('source' in entry) normalized.source = entry.source ?? 'curated';
    if ('version' in entry) normalized.version = entry.version ?? 1;
    if ('status' in entry) normalized.status = entry.status ?? 'approved';
    return normalized;
  });
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

export function buildFallbackConceptCatalog(): ConceptCatalogEntry[] {
  return Object.entries(conceptMap).map(([canonicalName, concept]) => ({
    id: `fallback-${canonicalName}`,
    canonicalName,
    aliases: [...concept.aliases],
    intents: [...concept.intents],
    description: null,
    entities: [],
    positivePhrases: [],
    negativePhrases: [],
    language: 'en',
    source: 'curated',
    version: 1,
  }));
}

function normalizeTopic(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
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

export function resolveTopicConcepts(topic: string, catalog: ConceptCatalogEntry[] = []): ResolvedConcept {
  const canonical = topic.trim();
  const key = normalizeTopic(canonical);
  const catalogMatch = catalog.find((entry) => (
    normalizeTopic(entry.canonicalName) === key
    || entry.aliases.some((alias) => normalizeTopic(alias) === key)
  ));

  if (catalogMatch) {
    return {
      canonical,
      aliases: [...new Set(catalogMatch.aliases)],
      intents: [...new Set(catalogMatch.intents)],
    };
  }

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

export function resolveTopicConceptTerms(topic: string, goalText?: string | null, catalog: ConceptCatalogEntry[] = []): string[] {
  const concept = resolveTopicConcepts(topic, catalog);
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

export function buildAlgorithmIntentProfile(algorithm?: Algorithm | null, catalog: ConceptCatalogEntry[] = []): AlgorithmIntentProfile {
  const canonicalTopics = (algorithm?.topic_weights ?? [])
    .filter((item) => item.weight >= 50 && item.topic.trim().length > 0)
    .sort((left, right) => right.weight - left.weight)
    .map((item) => item.topic.trim());

  const algorithmName = algorithm?.name?.trim() ?? '';
  if (algorithmName && !canonicalTopics.some((topic) => normalizeTopic(topic) === normalizeTopic(algorithmName))) {
    const algorithmConcept = resolveTopicConcepts(algorithmName, catalog);
    if (algorithmConcept.aliases.length > 0 || algorithmConcept.intents.length > 0) {
      canonicalTopics.push(algorithmName);
    }
  }

  const aliases = new Set<string>();
  const intents = new Set<string>();
  const semanticTerms = new Set<string>();

  for (const topic of canonicalTopics) {
    const concept = resolveTopicConcepts(topic, catalog);
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
  conceptEntries: ConceptCatalogEntry[] | Array<{
    id: string;
    canonical_name: string;
    aliases?: string[] | null;
    intents?: string[] | null;
  }>;
  algorithms: ConceptsApiAlgorithmRecord[];
}) {
  const concepts = conceptEntries.length > 0 && 'canonicalName' in conceptEntries[0]
    ? conceptEntries as ConceptCatalogEntry[]
    : buildConceptCatalog(conceptEntries as Array<{ id: string; canonical_name: string; aliases?: string[] | null; intents?: string[] | null }>);

  return {
    concepts,
    profiles: algorithms.map((algorithm) => ({
      algorithmId: algorithm.id,
      name: algorithm.name,
      profile: buildStoredOrDerivedAlgorithmIntentProfile(algorithm),
    })),
  };
}
