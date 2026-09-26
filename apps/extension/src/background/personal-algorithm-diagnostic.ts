import type { PersonalAlgorithmState } from '@repo/shared-types';
import {
  isScoreTraceConsistent,
  replayPersonalAlgorithmScore,
  scorePersonalAlgorithm,
  traceContributionTotal,
  type PersonalScoringPolicy,
  type ScoreCandidate,
} from '../../../../packages/recommender-core/src/personal-algorithm-scorer.ts';
import { createChromeLocalStateStorage, LocalPersonalAlgorithmStore } from '../lib/personal-algorithm-store';

export async function runPersonalAlgorithmLiveDiagnostic() {
  const store = new LocalPersonalAlgorithmStore(createChromeLocalStateStorage());
  await store.initialize();
  const state = await readState(store);

  const contentNode = state.graph.nodes.find((node) => node.kind === 'content' && node.content);
  if (!contentNode?.content) {
    throw new Error('No content node with content identity is available for the live #151 diagnostic.');
  }

  const createdByEdge = state.graph.edges.find(
    (edge) =>
      edge.relation === 'created_by'
      && edge.sourceNodeId === contentNode.id
      && state.graph.nodes.some((node) => node.id === edge.targetNodeId && node.kind === 'creator'),
  );
  if (!createdByEdge) {
    throw new Error(`No created_by edge is available for content node ${contentNode.id}.`);
  }

  const creatorNodeId = createdByEdge.targetNodeId;
  const candidate: ScoreCandidate = {
    id: `live-diagnostic:${contentNode.id}`,
    content: contentNode.content,
    nodeIds: [contentNode.id],
    creatorNodeId,
  };

  const feedbackEvidenceId = state.evidence.find(
    (record) =>
      record.evidence.kind === 'interaction'
      && record.evidence.content.source === candidate.content.source
      && record.evidence.content.externalId === candidate.content.externalId,
  )?.id;

  const policy: PersonalScoringPolicy = {
    revision: 'live-diagnostic-p1',
    baseScore: 1,
    nodeWeights: {
      [contentNode.id]: 2,
      [creatorNodeId]: 3,
    },
    edgeRelationWeights: {
      created_by: 4,
    },
    feedback: [
      {
        id: 'live-diagnostic-feedback',
        contentId: candidate.content.externalId,
        value: -0.5,
        label: 'live diagnostic feedback',
        evidenceIds: feedbackEvidenceId ? [feedbackEvidenceId] : [],
      },
    ],
    modes: {
      work: {
        baseDelta: 0.25,
        nodeWeights: {
          [creatorNodeId]: 0.75,
        },
      },
    },
  };

  const first = scorePersonalAlgorithm(state, candidate, policy, 'work');
  const replay = replayPersonalAlgorithmScore(state, candidate, policy, 'work');

  const result = {
    ok:
      first.score === 10.5
      && traceContributionTotal(first.trace) === first.score
      && isScoreTraceConsistent(first.trace)
      && replay.score === first.score
      && replay.trace.id === first.trace.id,
    state: {
      schemaVersion: state.schemaVersion,
      evidence: state.evidence.length,
      nodes: state.graph.nodes.length,
      edges: state.graph.edges.length,
      graphRevision: state.graph.currentRevision,
    },
    candidate: {
      id: candidate.id,
      contentNodeId: contentNode.id,
      creatorNodeId,
      createdByEdgeId: createdByEdge.id,
    },
    score: first.score,
    trace: {
      id: first.trace.id,
      scorerRevision: first.trace.scorerRevision,
      policyRevision: first.trace.policyRevision,
      graphRevision: first.trace.graphRevision,
      evidenceRevision: first.trace.evidenceRevision,
      baseScore: first.trace.baseScore,
      nodeContributions: first.trace.nodeContributions,
      edgeContributions: first.trace.edgeContributions,
      feedbackContributions: first.trace.feedbackContributions,
      modeContributions: first.trace.modeContributions,
      suppressionContributions: first.trace.suppressionContributions,
      contributionTotal: traceContributionTotal(first.trace),
      consistent: isScoreTraceConsistent(first.trace),
      policyOutcome: first.trace.policyOutcome,
    },
    replay: {
      score: replay.score,
      traceId: replay.trace.id,
      sameScore: replay.score === first.score,
      sameTraceId: replay.trace.id === first.trace.id,
      createdAtDiffers: replay.trace.createdAt !== first.trace.createdAt,
    },
  };

  if (!result.ok) {
    throw new Error(`#151 live diagnostic failed: ${JSON.stringify(result)}`);
  }

  return result;
}

async function readState(store: LocalPersonalAlgorithmStore): Promise<PersonalAlgorithmState> {
  return store.exportState();
}