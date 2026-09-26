import type { PersonalAlgorithmState } from '@repo/shared-types';
import {
  isScoreTraceConsistent,
  scorePersonalAlgorithm,
  type PersonalScoringPolicy,
  type ScoreCandidate,
  type ScoreFeedbackSignal,
  type PersonalScoreTrace,
} from '@repo/recommender-core';

export type LocalRuntimeCandidate = {
  external_id: string;
  title: string;
  channel_name?: string | null;
  channel_id?: string | null;
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
  score: number;
  visible: boolean;
  trace: PersonalScoreTrace;
};

export type LocalRuntimeFeedbackEvent = {
  contentItemId?: string;
  eventType?: string;
};

const contentNodeId = (source: string, externalId: string) =>
  `content:${encodeURIComponent(source)}:${encodeURIComponent(externalId)}`;

const candidateContext = (state: PersonalAlgorithmState, candidate: LocalRuntimeCandidate): ScoreCandidate => {
  const contentId = contentNodeId('youtube', candidate.external_id);
  const contentNode = state.graph.nodes.find((node) => node.id === contentId);
  const creatorEdge = contentNode
    ? state.graph.edges.find((edge) => (
      edge.relation === 'created_by'
      && edge.sourceNodeId === contentNode.id
      && state.graph.nodes.some((node) => node.id === edge.targetNodeId && node.kind === 'creator')
    ))
    : undefined;
  const creatorNodeId = creatorEdge?.targetNodeId ?? null;

  return {
    id: `youtube:${candidate.external_id}`,
    content: { source: 'youtube', externalId: candidate.external_id },
    nodeIds: contentNode ? [contentNode.id] : [],
    creatorNodeId,
  };
};

export function buildLocalScoringPolicy(state: PersonalAlgorithmState): PersonalScoringPolicy {
  const nodeWeights: Record<string, number> = {};
  for (const node of state.graph.nodes) {
    if (node.kind === 'content') nodeWeights[node.id] = 1;
    if (node.kind === 'creator') nodeWeights[node.id] = 2;
  }

  return {
    revision: 'local-mvp-p1',
    baseScore: 0,
    nodeWeights,
    edgeRelationWeights: {
      created_by: 3,
    },
  };
}

export function buildLocalFeedbackSignals(
  events: LocalRuntimeFeedbackEvent[],
): ScoreFeedbackSignal[] {
  return events
    .filter((event) => event.contentItemId && event.eventType)
    .map((event, index) => ({
      id: `local-feedback:${index}:${event.contentItemId}:${event.eventType}`,
      contentId: event.contentItemId ?? null,
      value: event.eventType === 'more_like_this'
        ? 10
        : event.eventType === 'not_interested'
          ? -10
          : event.eventType === 'never_show_channel'
            ? -100
            : 0,
      label: `explicit feedback: ${event.eventType}`,
    }))
    .filter((signal) => signal.value !== 0);
}

export function scoreLocalCandidates(
  state: PersonalAlgorithmState,
  candidates: LocalRuntimeCandidate[],
  mode: string,
  feedbackSignals: ScoreFeedbackSignal[] = [],
  sourceFilters: {
    includeShorts?: boolean;
    includeLive?: boolean;
  } = {},
): LocalRuntimeRankedCandidate[] {
  const policy = buildLocalScoringPolicy(state);

  return candidates
    .map((candidate) => {
      const context = candidateContext(state, candidate);
      const result = scorePersonalAlgorithm(state, context, policy, mode, feedbackSignals);
      const visible = !(
        (candidate.is_short && sourceFilters.includeShorts === false)
        || (candidate.is_live && sourceFilters.includeLive === false)
      );

      if (!isScoreTraceConsistent(result.trace)) {
        throw new Error(`Local score trace is inconsistent for ${candidate.external_id}`);
      }

      return {
        ...candidate,
        id: candidate.external_id,
        score: result.score,
        visible,
        trace: result.trace,
      };
    })
    .sort((left, right) => right.score - left.score || left.external_id.localeCompare(right.external_id));
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
