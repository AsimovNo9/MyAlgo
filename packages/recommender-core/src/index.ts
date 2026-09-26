import type { Algorithm, PersonalAlgorithmState } from '@repo/shared-types';

export interface ConceptCatalogEntry {
  id?: string;
  canonicalName: string;
  aliases?: string[];
  intents?: string[];
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

export interface RecommendationQuery {
  text: string;
  lane: 'goal' | 'topic' | 'alias' | 'format' | 'intent' | 'creator' | 'freshness';
  topics: string[];
}

export interface RecommendationQueryPlan extends RecommendationQuery {
  algorithmRevision: string;
}

export interface RecommendationProfile {
  goal: string;
  language: string | null;
  explicitTopics: string[];
  aliases: string[];
  intents: string[];
  semanticTerms: string[];
  positiveRuleTerms: string[];
  negativeRuleTerms: string[];
  preferredFormats: string[];
  creatorTerms: string[];
}

export interface RecommendationProfileRecord {
  id: string;
  goal: string;
  explicitTopics: string[];
  semanticTerms: string[];
  language?: string | null;
  aliases?: string[];
  intents?: string[];
  preferredFormats?: string[];
  updatedAt?: string;
}

export interface RecommendationInteractionRecord {
  id: string;
  userId: string;
  kind: 'click' | 'watch' | 'skip' | 'feedback' | 'like' | 'dislike';
  itemId: string;
  topTopics: string[];
  score: number;
  ts: string;
}

export interface RecommendationTraceRecord {
  id: string;
  userId: string;
  candidateId: string;
  retrievalLane: 'goal' | 'topic' | 'alias' | 'format' | 'intent' | 'creator' | 'freshness';
  score: number;
  explanation: string;
  ts?: string;
}

export interface RecommendationStoreSnapshot {
  version: number;
  generatedAt: string;
  profiles: Record<string, RecommendationProfileRecord>;
  interactions: RecommendationInteractionRecord[];
  traces: RecommendationTraceRecord[];
}

export interface RecommendationStore {
  getProfile(userId: string): RecommendationProfileRecord | undefined;
  upsertProfile(profile: RecommendationProfileRecord): RecommendationProfileRecord;
  deleteProfile(userId: string): void;
  listInteractions(userId: string): RecommendationInteractionRecord[];
  recordInteraction(interaction: RecommendationInteractionRecord): RecommendationInteractionRecord;
  listTraces(userId: string): RecommendationTraceRecord[];
  recordTrace(trace: RecommendationTraceRecord): RecommendationTraceRecord;
  exportSnapshot(): RecommendationStoreSnapshot;
}

export interface ConceptExpansionResult {
  canonicalName: string;
  aliases: string[];
  intents: string[];
  relatedConcepts: string[];
  version: number;
}

export interface CandidateMetadataEnrichment {
  title: string;
  description: string | null;
  creator: string | null;
  durationSeconds: number | null;
  language: string | null;
  concepts: string[];
  metadata: {
    title: string;
    description: string | null;
    creator: string | null;
    durationSeconds: number | null;
    language: string | null;
    publishedAt: string | null;
  };
  policy: {
    allowed: boolean;
    reasons: string[];
  };
}

export type PreferenceNamespace = 'explicit' | 'learned' | 'contextual';

export interface PreferenceSignal {
  namespace: PreferenceNamespace;
  key: string;
  value: number;
  confidence: number;
  evidence: number;
  source: string;
}

export interface PreferenceModel {
  explicit: Map<string, number>;
  learned: Map<string, number>;
  contextual: Map<string, number>;
  metadata: Map<string, { confidence: number; evidence: number; source: string; }>;
}

export type PreferenceModelSnapshot = {
  explicit: Record<string, number>;
  learned: Record<string, number>;
  contextual: Record<string, number>;
};

export interface PreferenceSummaryInterest {
  key: string;
  score: number;
  source: 'explicit' | 'learned' | 'contextual';
  confidence: number;
  evidence: number;
}

export interface RecommendationExplanation {
  id: string;
  traceId: string;
  topic: string;
  lane: 'goal' | 'topic' | 'alias' | 'format' | 'intent' | 'creator' | 'freshness';
  reasonCode: string;
  summary: string;
  evidence: Array<{ key: string; score: number; source: PreferenceNamespace; }>;
}

export interface RecommendationTrace {
  id: string;
  userId: string;
  candidateId: string;
  retrievalLane: 'goal' | 'topic' | 'alias' | 'format' | 'intent' | 'creator' | 'freshness';
  score: number;
  explanation: string;
  reasonCode: string;
  createdAt: string;
}

export interface RecommendationTraceReplay {
  traceId: string;
  baselineScore: number;
  counterfactualScore: number;
  delta: number;
  observedOutcome: 'click' | 'watch' | 'skip' | 'dismiss';
  status: 'stable' | 'improved' | 'regressed';
}

export interface RecommendationLabRow {
  itemId: string;
  rank: number;
  score: number;
  relevant: boolean;
  interest: string;
}

export interface RecommendationLabSummary {
  relevantAtK: number;
  precisionAtK: number;
  falsePositiveRate: number;
  coverage: number;
  averageScore: number;
}

export interface LocalFirstIntelligenceBenchmarkInput {
  precision: number;
  recall: number;
  f1: number;
  latencyMs: number;
  memoryMb: number;
  multilingualCoverage: number;
}

export interface LocalFirstIntelligenceBenchmarkResult {
  status: 'ready' | 'needs_benchmark' | 'requires_cloud_fallback';
  localPathReady: boolean;
  cloudFallbackAllowed: boolean;
  score: number;
  reasons: string[];
}

/** Source-neutral retrieval planning foundation. No YouTube Data API client backs these lanes; #206 implements RSS/web-search acquisition and #202 removes ambiguous provider-like naming. */
export type RetrievalLane = 'observed' | 'rss' | 'web_search' | 'explore';

export interface RetrievalLaneAssignment {
  lane: RetrievalLane;
  allocation: number;
  rationale: string;
}

export interface TopicRetrievalBudget {
  topic: string;
  currentCoverage: number;
  requiredCoverage: number;
  laneAssignments: RetrievalLaneAssignment[];
}

export interface RetrievalCoordinatorPlan {
  topicBudgets: TopicRetrievalBudget[];
  totalBudget: number;
  lanes: RetrievalLane[];
}

function normalizeConceptKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function lookupConceptByTopic(topic: string, catalog: ConceptCatalogEntry[] = []): ConceptCatalogEntry | undefined {
  const normalizedTopic = normalizeConceptKey(topic);
  if (!normalizedTopic) return undefined;

  const exactMatch = catalog.find((entry) => normalizeConceptKey(entry.canonicalName) === normalizedTopic)
    ?? catalog.find((entry) => (entry.aliases ?? []).some((alias) => normalizeConceptKey(alias) === normalizedTopic));
  if (exactMatch) return exactMatch;

  const semanticFallback: Record<string, string[]> = {
    gaming: ['game design', 'gameplay', 'indie games', 'esports'],
    'game design': ['gaming', 'gameplay', 'indie games', 'esports'],
    ai: ['llm', 'machine learning', 'generative ai', 'computer vision', 'agents'],
    'machine learning': ['ai', 'llm', 'generative ai'],
    productivity: ['deep work', 'focus', 'workflow systems', 'habits'],
    design: ['ux design', 'product design', 'design systems'],
  };

  const fallbackAliases = semanticFallback[normalizedTopic] ?? [];
  const directFallback = catalog.find((entry) => {
    const values = [entry.canonicalName, ...(entry.aliases ?? [])];
    return values.some((value) => fallbackAliases.some((alias) => normalizeConceptKey(value) === normalizeConceptKey(alias)));
  });
  if (directFallback) return directFallback;

  return catalog.find((entry) => {
    const values = [entry.canonicalName, ...(entry.aliases ?? [])];
    return values.some((value) => {
      const key = normalizeConceptKey(value);
      return key.includes(normalizedTopic) || normalizedTopic.includes(key);
    });
  });
}

export function buildConceptExpansion(
  topic: string,
  catalog: ConceptCatalogEntry[] = [],
  relations: ConceptRelationEntry[] = [],
): ConceptExpansionResult {
  const normalizedTopic = topic.trim();
  const concept = lookupConceptByTopic(normalizedTopic, catalog);

  const aliases = [...new Set((concept?.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))];
  const intents = [...new Set((concept?.intents ?? []).map((intent) => intent.trim()).filter(Boolean))];

  const relatedIds = new Set<string>();
  const relatedConcepts = new Set<string>();

  if (concept?.id) {
    const conceptId = concept.id;
    for (const relation of relations) {
      if (relation.source_concept_id === conceptId || relation.target_concept_id === conceptId) {
        const relatedId = relation.source_concept_id === conceptId ? relation.target_concept_id : relation.source_concept_id;
        if (relatedId) relatedIds.add(relatedId);
      }
    }
  }

  for (const relatedId of relatedIds) {
    const related = catalog.find((entry) => entry.id === relatedId);
    if (related?.canonicalName) {
      relatedConcepts.add(normalizeConceptKey(related.canonicalName));
    }
  }

  const version = concept?.version ?? 1;

  return {
    canonicalName: normalizedTopic,
    aliases,
    intents,
    relatedConcepts: [...relatedConcepts],
    version,
  };
}

export function buildCandidateMetadataEnrichment(
  input: {
    title: string;
    description?: string | null;
    creator?: string | null;
    durationSeconds?: number | null;
    language?: string | null;
    publishedAt?: string | null;
    topics?: string[];
  },
  catalog: ConceptCatalogEntry[] = [],
): CandidateMetadataEnrichment {
  const normalizedTitle = input.title?.trim() ?? '';
  const normalizedDescription = input.description?.trim() ?? null;
  const creator = input.creator?.trim() || null;
  const durationSeconds = Number.isFinite(input.durationSeconds) ? Number(input.durationSeconds) : null;
  const language = typeof input.language === 'string' && input.language.trim() ? input.language.trim().toLowerCase() : null;
  const candidateTopics = (input.topics ?? []).map((topic) => topic.trim()).filter(Boolean);
  const concepts = new Set<string>();

  for (const topic of candidateTopics) {
    const concept = catalog.find((entry) => entry.canonicalName.toLowerCase() === topic.toLowerCase())
      ?? catalog.find((entry) => (entry.aliases ?? []).some((alias) => alias.toLowerCase() === topic.toLowerCase()));
    if (concept?.canonicalName) {
      concepts.add(concept.canonicalName.toLowerCase());
      for (const alias of concept.aliases ?? []) {
        if (alias.trim()) concepts.add(alias.trim().toLowerCase());
      }
    } else {
      concepts.add(topic.toLowerCase());
    }
  }

  return {
    title: normalizedTitle,
    description: normalizedDescription,
    creator,
    durationSeconds,
    language,
    concepts: [...concepts],
    metadata: {
      title: normalizedTitle,
      description: normalizedDescription,
      creator,
      durationSeconds,
      language,
      publishedAt: input.publishedAt ?? null,
    },
    policy: {
      allowed: true,
      reasons: ['concept metadata normalized', 'candidate enrichment approved'],
    },
  };
}

export function buildPreferenceModel(): PreferenceModel {
  return {
    explicit: new Map(),
    learned: new Map(),
    contextual: new Map(),
    metadata: new Map(),
  };
}

export function applyPreferenceSignal(model: PreferenceModel, signal: PreferenceSignal): PreferenceModel {
  const key = signal.key.trim().toLowerCase();
  if (!key) return model;

  const target = signal.namespace === 'explicit'
    ? model.explicit
    : signal.namespace === 'learned'
      ? model.learned
      : model.contextual;

  const boundedValue = Math.max(-1, Math.min(1, Number(signal.value) || 0));
  const previousValue = target.get(key) ?? 0;
  const mergedValue = signal.namespace === 'explicit'
    ? boundedValue
    : Math.max(-1, Math.min(1, Math.max(previousValue, boundedValue)));

  target.set(key, mergedValue);
  model.metadata.set(key, {
    confidence: Math.max(0, Math.min(1, Number(signal.confidence) || 0)),
    evidence: Math.max(0, Number(signal.evidence) || 0),
    source: signal.source,
  });

  return model;
}

export function decayPreferenceModel(model: PreferenceModel, factor = 0.5): PreferenceModel {
  for (const [key, value] of model.learned.entries()) {
    const decayed = value * Math.max(0, Math.min(1, factor));
    model.learned.set(key, Math.max(-1, Math.min(1, decayed)));
  }

  for (const [key, value] of model.contextual.entries()) {
    const decayed = value * Math.max(0, Math.min(1, factor));
    model.contextual.set(key, Math.max(-1, Math.min(1, decayed)));
  }

  return model;
}

export function exportPreferenceModel(model: PreferenceModel): PreferenceModelSnapshot {
  return {
    explicit: Object.fromEntries([...model.explicit.entries()].map(([key, value]) => [key, Number(value)])),
    learned: Object.fromEntries([...model.learned.entries()].map(([key, value]) => [key, Number(value)])),
    contextual: Object.fromEntries([...model.contextual.entries()].map(([key, value]) => [key, Number(value)])),
  };
}

export function resetPreferenceModel(model: PreferenceModel): PreferenceModelSnapshot {
  const snapshot = exportPreferenceModel(model);
  model.explicit.clear();
  model.learned.clear();
  model.contextual.clear();
  model.metadata.clear();
  return {
    explicit: {},
    learned: {},
    contextual: {},
  };
}

export function getPreferenceScore(model: PreferenceModel, key: string): number {
  const normalized = key.trim().toLowerCase();
  const explicit = model.explicit.get(normalized) ?? 0;
  const learned = model.learned.get(normalized) ?? 0;
  const contextual = model.contextual.get(normalized) ?? 0;

  return Math.max(-1, Math.min(1, explicit > 0 ? explicit : learned + contextual));
}

export function buildPreferenceSummary(model: PreferenceModel): { interests: PreferenceSummaryInterest[] } {
  const entries = new Map<string, PreferenceSummaryInterest>();

  for (const [namespace, values] of [
    ['explicit', model.explicit],
    ['learned', model.learned],
    ['contextual', model.contextual],
  ] as const) {
    for (const [key, score] of values.entries()) {
      const existing = entries.get(key) ?? {
        key,
        score: 0,
        source: namespace,
        confidence: 0,
        evidence: 0,
      };
      existing.score = Math.max(-1, Math.min(1, score));
      existing.source = namespace;
      const metadata = model.metadata.get(key) ?? { confidence: 0, evidence: 0, source: namespace };
      existing.confidence = metadata.confidence;
      existing.evidence = metadata.evidence;
      entries.set(key, existing);
    }
  }

  return {
    interests: [...entries.values()].sort((left, right) => Math.abs(right.score) - Math.abs(left.score)).slice(0, 12),
  };
}

export function buildRecommendationExplanation({
  topic,
  lane,
  traceId,
  model,
  reasonCode,
  candidateSummary,
}: {
  topic: string;
  lane: 'goal' | 'topic' | 'alias' | 'format' | 'intent' | 'creator' | 'freshness';
  traceId: string;
  model: PreferenceModel;
  reasonCode: string;
  candidateSummary: string;
}): RecommendationExplanation {
  const normalizedTopic = topic.trim();
  const summary = buildPreferenceSummary(model);
  const relevant = summary.interests.filter((interest) => interest.key === normalizedTopic.toLowerCase() || interest.key.includes(normalizedTopic.toLowerCase()));
  const weights = relevant.length > 0 ? relevant : summary.interests.slice(0, 3);
  const best = weights[0];
  const evidence: RecommendationExplanation['evidence'] = (weights.length > 0 ? weights : [{ key: normalizedTopic.toLowerCase(), score: 0, source: 'learned', confidence: 0, evidence: 0 }])
    .map((interest) => ({ key: interest.key, score: interest.score, source: interest.source as PreferenceNamespace }));

  return {
    id: `exp-${traceId}`,
    traceId,
    topic: normalizedTopic,
    lane,
    reasonCode,
    summary: `${candidateSummary} is recommended because ${best ? `${best.key} is a strong ${best.source} preference` : 'the candidate matches your interest profile'}; ${evidence.map((item) => `${item.key}:${item.score.toFixed(2)}`).join(', ')}`,
    evidence,
  };
}

export function evaluateLocalFirstIntelligenceBenchmark(input: LocalFirstIntelligenceBenchmarkInput): LocalFirstIntelligenceBenchmarkResult {
  const metrics = {
    precision: Number(input.precision) || 0,
    recall: Number(input.recall) || 0,
    f1: Number(input.f1) || 0,
    latencyMs: Number(input.latencyMs) || 0,
    memoryMb: Number(input.memoryMb) || 0,
    multilingualCoverage: Number(input.multilingualCoverage) || 0,
  };

  const reasons: string[] = [];

  if (metrics.precision < 0.75 || metrics.recall < 0.7 || metrics.f1 < 0.75) {
    reasons.push('quality threshold not met');
  }
  if (metrics.latencyMs > 250) {
    reasons.push('latency exceeds local-first budget');
  }
  if (metrics.memoryMb > 300) {
    reasons.push('memory exceeds local-first budget');
  }
  if (metrics.multilingualCoverage < 0.75) {
    reasons.push('multilingual coverage below target');
  }

  const localPathReady = reasons.length === 0;
  const score = (
    metrics.precision * 0.3
    + metrics.recall * 0.25
    + metrics.f1 * 0.25
    + (1 - Math.min(1, metrics.latencyMs / 500)) * 0.1
    + (1 - Math.min(1, metrics.memoryMb / 500)) * 0.05
    + metrics.multilingualCoverage * 0.05
  );

  if (localPathReady) {
    return {
      status: 'ready',
      localPathReady: true,
      cloudFallbackAllowed: false,
      score,
      reasons: [],
    };
  }

  return {
    status: reasons.length > 0 ? 'needs_benchmark' : 'requires_cloud_fallback',
    localPathReady: false,
    cloudFallbackAllowed: true,
    score,
    reasons,
  };
}

export function buildRecommendationTrace({
  userId,
  candidateId,
  retrievalLane,
  score,
  explanation,
  reasonCode,
}: {
  userId: string;
  candidateId: string;
  retrievalLane: 'goal' | 'topic' | 'alias' | 'format' | 'intent' | 'creator' | 'freshness';
  score: number;
  explanation: string;
  reasonCode: string;
}): RecommendationTrace {
  return {
    id: `trace-${candidateId}-${Math.random().toString(36).slice(2, 9)}`,
    userId,
    candidateId,
    retrievalLane,
    score,
    explanation,
    reasonCode,
    createdAt: new Date().toISOString(),
  };
}

export function replayRecommendationTrace({
  trace,
  baselineScore,
  counterfactualScore,
  observedOutcome,
}: {
  trace: RecommendationTrace;
  baselineScore: number;
  counterfactualScore: number;
  observedOutcome: 'click' | 'watch' | 'skip' | 'dismiss';
}): RecommendationTraceReplay {
  const delta = counterfactualScore - baselineScore;
  const status = delta > 0 ? 'improved' : delta < 0 ? 'regressed' : 'stable';

  return {
    traceId: trace.id,
    baselineScore,
    counterfactualScore,
    delta,
    observedOutcome,
    status,
  };
}

export function buildRecommendationLabSummary(rows: RecommendationLabRow[], k = 10): RecommendationLabSummary {
  const topK = rows.filter((row) => row.rank <= k);
  const relevantInTopK = topK.filter((row) => row.relevant).length;
  const precisionAtK = topK.length > 0 ? relevantInTopK / topK.length : 0;
  const falsePositiveRate = topK.length > 0
    ? topK.filter((row) => !row.relevant).length / topK.length
    : 0;
  const coverage = rows.length > 0
    ? new Set(rows.filter((row) => row.relevant).map((row) => row.interest)).size / new Set(rows.map((row) => row.interest)).size
    : 0;
  const averageScore = rows.length > 0 ? rows.reduce((sum, row) => sum + row.score, 0) / rows.length : 0;

  return {
    relevantAtK: relevantInTopK,
    precisionAtK,
    falsePositiveRate,
    coverage,
    averageScore,
  };
}

export function buildRetrievalCoordinatorPlan({
  topics,
  currentCoverage,
  targetPerTopic = 4,
  lanes = ['observed', 'rss', 'web_search', 'explore'],
}: {
  topics: string[];
  currentCoverage: Record<string, number>;
  targetPerTopic?: number;
  lanes?: RetrievalLane[];
}): RetrievalCoordinatorPlan {
  const normalizedTopics = [...new Set(topics.map((topic) => topic.trim().toLowerCase()).filter(Boolean))];
  const safeLanes: RetrievalLane[] = lanes.length > 0
    ? lanes
    : ['observed', 'rss', 'web_search', 'explore'];
  const budgets = normalizedTopics.map((topic) => {
    const current = Number(currentCoverage[topic] ?? 0);
    const required = Math.max(0, Math.ceil(targetPerTopic - current));
    const laneAssignments: RetrievalLaneAssignment[] = [];

    if (required > 0) {
      const laneCount = safeLanes.length;
      const baseBudget = Math.max(1, Math.ceil(required / laneCount));
      for (let index = 0; index < safeLanes.length; index += 1) {
        const lane: RetrievalLane = safeLanes[index];
        const allocation = index === safeLanes.length - 1
          ? Math.max(1, required - laneAssignments.reduce((sum, item) => sum + item.allocation, 0))
          : baseBudget;
        laneAssignments.push({
          lane,
          allocation,
          rationale: required > 0
            ? `${topic} is under target; boost ${lane} coverage.`
            : `${topic} already cleared coverage target.`,
        });
      }
    }

    return {
      topic,
      currentCoverage: current,
      requiredCoverage: required,
      laneAssignments,
    };
  });

  const totalBudget = budgets.reduce((sum, item) => sum + item.laneAssignments.reduce((laneSum, lane) => laneSum + lane.allocation, 0), 0);

  return {
    topicBudgets: budgets,
    totalBudget,
    lanes: safeLanes,
  };
}

export function createMemoryRecommendationStore(initial?: {
  profile?: RecommendationProfileRecord;
  profiles?: Record<string, RecommendationProfileRecord>;
  interactions?: RecommendationInteractionRecord[];
  traces?: RecommendationTraceRecord[];
}): RecommendationStore {
  const profiles = new Map<string, RecommendationProfileRecord>();
  const interactions = new Map<string, RecommendationInteractionRecord>();
  const traces = new Map<string, RecommendationTraceRecord>();

  if (initial?.profile) {
    profiles.set(initial.profile.id, { ...initial.profile, updatedAt: initial.profile.updatedAt ?? new Date().toISOString() });
  }

  for (const [userId, profile] of Object.entries(initial?.profiles ?? {})) {
    profiles.set(userId, { ...profile, updatedAt: profile.updatedAt ?? new Date().toISOString() });
  }

  for (const interaction of initial?.interactions ?? []) {
    interactions.set(interaction.id, interaction);
  }

  for (const trace of initial?.traces ?? []) {
    traces.set(trace.id, trace);
  }

  return {
    getProfile(userId: string) {
      return profiles.get(userId);
    },
    upsertProfile(profile: RecommendationProfileRecord) {
      const record = {
        ...profile,
        updatedAt: profile.updatedAt ?? new Date().toISOString(),
      };
      profiles.set(record.id, record);
      return record;
    },
    deleteProfile(userId: string) {
      profiles.delete(userId);
    },
    listInteractions(userId: string) {
      return [...interactions.values()].filter((interaction) => interaction.userId === userId);
    },
    recordInteraction(interaction: RecommendationInteractionRecord) {
      const record = { ...interaction, ts: interaction.ts ?? new Date().toISOString() };
      interactions.set(record.id, record);
      return record;
    },
    listTraces(userId: string) {
      return [...traces.values()].filter((trace) => trace.userId === userId);
    },
    recordTrace(trace: RecommendationTraceRecord) {
      const record = { ...trace, ts: trace.ts ?? new Date().toISOString() };
      traces.set(record.id, record);
      return record;
    },
    exportSnapshot(): RecommendationStoreSnapshot {
      return {
        version: 1,
        generatedAt: new Date().toISOString(),
        profiles: Object.fromEntries([...profiles.entries()]),
        interactions: [...interactions.values()],
        traces: [...traces.values()],
      };
    },
  };
}

const fallbackConceptMap: Record<string, { aliases: string[]; intents: string[] }> = {
  gaming: {
    aliases: ['game design', 'game development', 'gameplay', 'indie games', 'esports'],
    intents: ['game design', 'gameplay systems', 'game mechanics', 'indie game development'],
  },
  ai: {
    aliases: ['llm', 'machine learning', 'generative ai', 'computer vision', 'agents'],
    intents: ['model training', 'ai systems', 'llm workflows', 'agent architecture'],
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
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeStringList(values?: string[] | null): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeLanguage(language?: string | null): string | null {
  const normalized = language?.trim().toLowerCase() ?? '';
  return /^[a-z]{2}$/.test(normalized) ? normalized : null;
}

function normalizeFormats(formats?: string[]): string[] {
  return [...new Set((formats ?? []).map((format) => format.trim().toLowerCase()).filter(Boolean))];
}

function resolveFallbackConcept(topic: string): { canonical: string; aliases: string[]; intents: string[] } {
  const key = normalizeTopic(topic);
  const exactMatch = fallbackConceptMap[key] ?? null;

  if (exactMatch) {
    return { canonical: topic.trim(), aliases: [...exactMatch.aliases], intents: [...exactMatch.intents] };
  }

  for (const [conceptKey, concept] of Object.entries(fallbackConceptMap)) {
    const normalizedConceptKey = normalizeTopic(conceptKey);
    const matchesConcept = normalizedConceptKey === key;
    const aliasMatches = concept.aliases.some((alias) => normalizeTopic(alias) === key);
    const containsMatch = normalizedConceptKey.includes(key) || key.includes(normalizedConceptKey);
    if (matchesConcept || aliasMatches || containsMatch) {
      return { canonical: conceptKey, aliases: [...concept.aliases], intents: [...concept.intents] };
    }
  }

  return { canonical: topic.trim(), aliases: [], intents: [] };
}

function resolveTopicConcepts(topic: string, catalog: ConceptCatalogEntry[] = []): { canonical: string; aliases: string[]; intents: string[] } {
  const canonical = topic.trim();
  const key = normalizeTopic(canonical);
  const catalogMatch = catalog.find((entry) => normalizeTopic(entry.canonicalName) === key || (entry.aliases ?? []).some((alias) => normalizeTopic(alias) === key));

  if (catalogMatch) {
    return {
      canonical,
      aliases: [...new Set((catalogMatch.aliases ?? []).filter(Boolean))],
      intents: [...new Set((catalogMatch.intents ?? []).filter(Boolean))],
    };
  }

  return resolveFallbackConcept(canonical);
}

function resolveTopicConceptTerms(topic: string, goalText?: string | null, catalog: ConceptCatalogEntry[] = []): string[] {
  const concept = resolveTopicConcepts(topic, catalog);
  const terms = new Set<string>([concept.canonical]);

  for (const alias of concept.aliases) {
    terms.add(alias);
  }

  const goal = (goalText ?? '').trim();
  if (goal) {
    const normalizedGoal = goal.toLowerCase();
    for (const intent of concept.intents) {
      if (normalizedGoal.includes(intent.toLowerCase()) || intent.toLowerCase().includes(normalizedGoal)) {
        terms.add(intent);
      }
    }
  }

  return [...terms].filter(Boolean);
}

export function buildAlgorithmIntentProfile(algorithm?: Algorithm | null, catalog: ConceptCatalogEntry[] = []): {
  canonicalTopics: string[];
  aliases: string[];
  intents: string[];
  semanticTerms: string[];
} {
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

export function buildGraphRetrievalProfile(
  state: PersonalAlgorithmState,
  options: {
    minimumInferredConfidence?: number;
    maxTopics?: number;
    maxCreators?: number;
  } = {},
): RecommendationProfile {
  const minimumInferredConfidence = options.minimumInferredConfidence ?? 0.5;
  const maxTopics = options.maxTopics ?? 8;
  const maxCreators = options.maxCreators ?? 4;
  const eligible = state.graph.nodes.filter((node) => (
    node.provenance === 'explicit'
    || (node.confidence ?? 0) >= minimumInferredConfidence
  ));
  const rankNodes = (kind: 'topic' | 'concept' | 'objective' | 'creator') => eligible
    .filter((node) => node.kind === kind && node.label.trim())
    .sort((left, right) => {
      const explicitDelta = Number(right.provenance === 'explicit') - Number(left.provenance === 'explicit');
      if (explicitDelta !== 0) return explicitDelta;
      const confidenceDelta = (right.confidence ?? 0) - (left.confidence ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return left.label.localeCompare(right.label);
    });

  const topics = [...rankNodes('topic'), ...rankNodes('concept')]
    .filter((node, index, all) => all.findIndex((candidate) => (
      normalizeTopic(candidate.label) === normalizeTopic(node.label)
    )) === index)
    .slice(0, maxTopics)
    .map((node) => node.label.trim());
  const goals = rankNodes('objective').slice(0, 2).map((node) => node.label.trim());
  const creators = rankNodes('creator').slice(0, maxCreators).map((node) => node.label.trim());
  const preferredFormats = [...new Set(eligible.flatMap((node) => {
    const format = node.attributes?.format;
    return typeof format === 'string' && format.trim() ? [format.trim().toLowerCase()] : [];
  }))].slice(0, 4);
  const language = eligible
    .map((node) => node.attributes?.language)
    .find((value): value is string => typeof value === 'string' && /^[a-z]{2}$/i.test(value.trim()))
    ?.trim()
    .toLowerCase() ?? null;

  return {
    goal: goals.join('; '),
    language,
    explicitTopics: topics,
    aliases: [],
    intents: [],
    semanticTerms: [...new Set([...topics, ...goals, ...creators])],
    positiveRuleTerms: [],
    negativeRuleTerms: [],
    preferredFormats: preferredFormats.length > 0 ? preferredFormats : ['guide'],
    creatorTerms: creators,
  };
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

function inferPreferredFormats(goal: string, positiveRuleTerms: string[]): string[] {
  const text = `${goal} ${positiveRuleTerms.join(' ')}`;
  return /learn|course|lecture|tutorial|study|education|university|lesson/i.test(text)
    ? ['tutorial']
    : ['guide'];
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildTopicQueries(profile: RecommendationProfile, topic: string, catalog: ConceptCatalogEntry[] = []): RecommendationQuery[] {
  const terms = resolveTopicConceptTerms(topic, profile.goal, catalog)
    .filter((term) => term.toLowerCase() !== topic.toLowerCase());
  const aliasTerms = [...new Set(terms)];

  return [
    ...profile.preferredFormats.map((format) => ({
      text: `${topic} ${format}`,
      lane: 'format' as const,
      topics: [topic],
    })),
    ...aliasTerms.map((term) => ({ text: term, lane: 'alias' as const, topics: [topic] })),
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
  const strongIds = new Set(strongConcepts.map((concept) => concept.id ?? concept.canonicalName));
  const allowedRelations = new Set(['parent_of', 'child_of', 'related_to', 'example_of', 'often_cooccurs_with', 'format_for']);

  return relations
    .filter((relation) => strongIds.has(relation.source_concept_id) && allowedRelations.has(relation.relation_type) && relation.weight >= 0.5)
    .sort((left, right) => right.weight - left.weight)
    .flatMap((relation) => {
      const source = catalog.find((concept) => (concept.id ?? concept.canonicalName) === relation.source_concept_id);
      const target = catalog.find((concept) => (concept.id ?? concept.canonicalName) === relation.target_concept_id);
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
  limit = 5,
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

export function buildRecommendationQueryPlans(
  profile: RecommendationProfile,
  limit = 5,
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

export function buildStoredOrDerivedAlgorithmIntentProfile(
  algorithm?: { id?: string; name: string; goal_text?: string | null; topic_weights?: Array<{ topic: string; weight: number }> } | null,
): { canonicalTopics: string[]; aliases: string[]; intents: string[]; semanticTerms: string[] } {
  if (!algorithm) {
    return buildAlgorithmIntentProfile(null);
  }

  return buildAlgorithmIntentProfile({
    id: algorithm.id,
    name: algorithm.name,
    goal_text: algorithm.goal_text ?? null,
    topic_weights: algorithm.topic_weights ?? [],
  });
}


export * from './personal-algorithm-scorer.ts';
