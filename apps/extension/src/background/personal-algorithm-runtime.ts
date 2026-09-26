import type { FeedSourceFilters, PersonalAlgorithmState } from '@repo/shared-types';
import {
  isScoreTraceConsistent,
  scorePersonalAlgorithm,
  type PersonalScoringPolicy,
  type ScoreCandidate,
  type ScoreFeedbackSignal,
  type ScoreFeatureSignal,
  type PersonalScoreTrace,
} from '@repo/recommender-core';

export type LocalRuntimeCandidate = {
  external_id: string;
  title: string;
  firstSeenAt: string;
  lastSeenAt: string;
  channel_name?: string | null;
  channel_id?: string | null;
  description?: string | null;
  duration_seconds?: number | null;
  source_kind?: 'subscription' | 'discovery' | 'liked' | null;
  published_at?: string | null;
  topics?: string[];
  content_type?: string | null;
  language?: string | null;
  format?: string | null;
  is_short?: boolean;
  is_live?: boolean;
};

export type LocalRuntimeRankedCandidate = LocalRuntimeCandidate & {
  id: string;
  rawScore: number;
  score: number;
  visible: boolean;
  trace: PersonalScoreTrace;
};

export type LocalRuntimeFeedbackEvent = {
  contentItemId?: string;
  eventType?: string;
  recordedAt?: string;
  channelId?: string | null;
};

const contentNodeId = (source: string, externalId: string) =>
  `content:${encodeURIComponent(source)}:${encodeURIComponent(externalId)}`;


const FEATURE_WEIGHTS = {
  objective: 18,
  topic: 14,
  concept: 10,
  format: 6,
} as const;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'the', 'this', 'to', 'with', 'you', 'your',
]);

const normalizeFeatureText = (value: string | null | undefined): string =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const featureTokens = (value: string | null | undefined): string[] =>
  normalizeFeatureText(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

const lexicalMatch = (label: string, candidateText: string): number => {
  const normalizedLabel = normalizeFeatureText(label);
  if (!normalizedLabel || !candidateText) return 0;
  if (candidateText.includes(normalizedLabel)) return 1;
  const labelTokens = featureTokens(normalizedLabel);
  if (labelTokens.length === 0) return 0;
  const candidateTokens = new Set(featureTokens(candidateText));
  const overlap = labelTokens.filter((token) => candidateTokens.has(token)).length;
  const ratio = overlap / labelTokens.length;
  return ratio >= 0.5 ? ratio : 0;
};

const inferredFormat = (candidate: LocalRuntimeCandidate): string | null => {
  if (candidate.is_short) return 'short';
  if (candidate.is_live) return 'live';
  if (candidate.format?.trim()) return normalizeFeatureText(candidate.format);
  const text = normalizeFeatureText(candidate.title);
  if (/\b(podcast|interview)\b/.test(text)) return 'podcast';
  if (/\b(tutorial|course|guide|explained|learn)\b/.test(text)) return 'tutorial';
  if (/\b(album|music|song|mix)\b/.test(text)) return 'music';
  if (/\b(review|benchmark)\b/.test(text)) return 'review';
  return null;
};

export function extractLocalCandidateFeatures(
  state: PersonalAlgorithmState,
  candidate: LocalRuntimeCandidate,
): { nodeIds: string[]; features: ScoreFeatureSignal[] } {
  const text = normalizeFeatureText([
    candidate.title,
    candidate.description ?? '',
    candidate.channel_name ?? '',
    ...(candidate.topics ?? []),
  ].join(' '));
  const nodeIds: string[] = [];
  const features: ScoreFeatureSignal[] = [];

  for (const node of state.graph.nodes) {
    if (!['objective', 'topic', 'concept'].includes(node.kind)) continue;
    const similarity = lexicalMatch(node.label, text);
    if (similarity <= 0) continue;
    const confidence = Math.min(1, Math.max(0, Number.isFinite(node.confidence) ? node.confidence : 1));
    const weight = FEATURE_WEIGHTS[node.kind as keyof typeof FEATURE_WEIGHTS];
    const value = Number((weight * similarity * confidence).toFixed(2));
    if (value <= 0) continue;
    nodeIds.push(node.id);
    features.push({
      id: `${node.kind}:${node.id}`,
      label: `${node.kind} match: ${node.label}`,
      value,
      sourceId: node.id,
    });
  }

  const format = inferredFormat(candidate);
  if (format) {
    const formatNode = state.graph.nodes
      .filter((node) => ['objective', 'topic', 'concept'].includes(node.kind))
      .find((node) => normalizeFeatureText(
        typeof node.attributes?.format === 'string' ? node.attributes.format : '',
      ) === format);
    if (formatNode) {
      const confidence = Math.min(1, Math.max(0, Number.isFinite(formatNode.confidence) ? formatNode.confidence : 1));
      features.push({
        id: `format:${formatNode.id}:${format}`,
        label: `format match: ${format}`,
        value: Number((FEATURE_WEIGHTS.format * confidence).toFixed(2)),
        sourceId: formatNode.id,
      });
      nodeIds.push(formatNode.id);
    }
  }

  if (candidate.published_at && candidate.lastSeenAt) {
    const published = new Date(candidate.published_at).getTime();
    const observed = new Date(candidate.lastSeenAt).getTime();
    if (Number.isFinite(published) && Number.isFinite(observed) && observed >= published) {
      const ageDays = (observed - published) / (24 * 60 * 60 * 1000);
      const freshness = ageDays <= 1 ? 4 : ageDays <= 7 ? 2.5 : ageDays <= 30 ? 1 : 0;
      if (freshness > 0) {
        features.push({
          id: 'freshness',
          label: ageDays <= 1 ? 'freshness: published today' : ageDays <= 7 ? 'freshness: published this week' : 'freshness: published this month',
          value: freshness,
        });
      }
    }
  }

  return {
    nodeIds: [...new Set(nodeIds)].sort(),
    features: features.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function calibrateLocalScore(rawScore: number): number {
  if (!Number.isFinite(rawScore)) return 0;
  return Math.max(0, Math.min(100, Math.round(50 + 50 * Math.tanh(rawScore / 30))));
}

const candidateContext = (state: PersonalAlgorithmState, candidate: LocalRuntimeCandidate): ScoreCandidate => {
  const contentId = contentNodeId('youtube', candidate.external_id);
  const contentNode = state.graph.nodes.find((node) => node.id === contentId);
  const extracted = extractLocalCandidateFeatures(state, candidate);
  const creatorEdge = contentNode
    ? state.graph.edges.find((edge) => (
      edge.relation === 'created_by'
      && edge.sourceNodeId === contentNode.id
      && state.graph.nodes.some((node) => node.id === edge.targetNodeId && node.kind === 'creator')
    ))
    : undefined;
  const creatorNodeId = creatorEdge?.targetNodeId
    ?? (candidate.channel_id
      ? state.graph.nodes.find((node) => (
        node.kind === 'creator'
        && node.id === `creator:youtube:${encodeURIComponent(candidate.channel_id ?? '')}`
      ))?.id ?? null
      : null)
    ?? (candidate.channel_name
      ? state.graph.nodes.find((node) => (
        node.kind === 'creator'
        && node.label.trim().toLowerCase() === candidate.channel_name?.trim().toLowerCase()
      ))?.id ?? null
      : null);

  return {
    id: `youtube:${candidate.external_id}`,
    content: { source: 'youtube', externalId: candidate.external_id },
    nodeIds: [...new Set([...(contentNode ? [contentNode.id] : []), ...extracted.nodeIds])],
    creatorNodeId,
    features: extracted.features,
  };
};

export function buildLocalScoringPolicy(state: PersonalAlgorithmState): PersonalScoringPolicy {
  const nodeWeights: Record<string, number> = {};
  for (const node of state.graph.nodes) {
    if (node.kind === 'content') nodeWeights[node.id] = 1;
    if (node.kind === 'creator') nodeWeights[node.id] = 8;
  }

  return {
    revision: 'local-mvp-p2',
    baseScore: 0,
    nodeWeights,
    edgeRelationWeights: {
      created_by: 2,
    },
  };
}

export function buildLocalFeedbackSignals(
  events: LocalRuntimeFeedbackEvent[],
  state?: PersonalAlgorithmState,
): ScoreFeedbackSignal[] {
  const latestByContent = new Map<string, LocalRuntimeFeedbackEvent>();
  events.forEach((event, index) => {
    if (!event.contentItemId || !event.eventType) return;
    const key = event.contentItemId;
    const previous = latestByContent.get(key);
    if (
      !previous
      || (event.recordedAt ?? '').localeCompare(previous.recordedAt ?? '') >= 0
      || (!event.recordedAt && !previous.recordedAt && index >= 0)
    ) {
      latestByContent.set(key, event);
    }
  });

  return [...latestByContent.values()]
    .map((event) => {
      const contentId = event.contentItemId ?? null;
      const contentNode = state?.graph.nodes.find((node) => node.id === contentNodeId('youtube', contentId ?? ''));
      const creatorEdge = contentNode
        ? state?.graph.edges.find((edge) => (
          edge.relation === 'created_by'
          && edge.sourceNodeId === contentNode.id
          && state.graph.nodes.some((node) => node.id === edge.targetNodeId && node.kind === 'creator')
        ))
        : undefined;
      const nodeId = event.eventType === 'never_show_channel'
        ? (
          event.channelId
            ? `creator:youtube:${encodeURIComponent(event.channelId)}`
            : creatorEdge?.targetNodeId ?? null
        )
        : null;
      const value = event.eventType === 'more_like_this'
        ? 10
        : event.eventType === 'not_interested'
          ? -10
          : event.eventType === 'never_show_channel'
            ? -100
            : 0;
      return {
        id: `local-feedback:${contentId}:${event.eventType}`,
        contentId,
        nodeId,
        value,
        label: `explicit feedback: ${event.eventType}`,
      };
    })
    .filter((signal) => signal.value !== 0);
}

export function scoreLocalCandidates(
  state: PersonalAlgorithmState,
  candidates: LocalRuntimeCandidate[],
  mode: string,
  feedbackSignals: ScoreFeedbackSignal[] = [],
  sourceFilters: FeedSourceFilters = {},
): LocalRuntimeRankedCandidate[] {
  const policy = buildLocalScoringPolicy(state);

  return candidates
    .map((candidate) => {
      const context = candidateContext(state, candidate);
      const result = scorePersonalAlgorithm(state, context, policy, mode, feedbackSignals);
      const visible = !(
        (candidate.is_short && sourceFilters.includeShorts === false)
        || (candidate.is_live && sourceFilters.includeLive === false)
        || (sourceFilters.subscribedOnly === true && candidate.source_kind !== 'subscription')
        || (sourceFilters.includeDiscovery === false && candidate.source_kind === 'discovery')
      );

      if (!isScoreTraceConsistent(result.trace)) {
        throw new Error(`Local score trace is inconsistent for ${candidate.external_id}`);
      }

      return {
        ...candidate,
        id: candidate.external_id,
        rawScore: result.score,
        score: calibrateLocalScore(result.score),
        visible,
        trace: result.trace,
      };
    })
    .sort((left, right) => right.score - left.score || right.rawScore - left.rawScore || left.external_id.localeCompare(right.external_id));
}

export function traceForLocalCandidate(
  state: PersonalAlgorithmState,
  candidate: LocalRuntimeCandidate,
  mode: string,
  feedbackSignals: ScoreFeedbackSignal[] = [],
): PersonalScoreTrace {
  const policy = buildLocalScoringPolicy(state);
  const result = scorePersonalAlgorithm(state, candidateContext(state, candidate), policy, mode, feedbackSignals);
  if (!isScoreTraceConsistent(result.trace)) {
    throw new Error(`Local score trace is inconsistent for ${candidate.external_id}`);
  }
  return result.trace;
}
