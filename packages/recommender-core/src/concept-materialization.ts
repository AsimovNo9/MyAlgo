import type {
  GraphEdge,
  GraphNode,
  PersonalAlgorithmState,
} from '@repo/shared-types';

export const SEMANTIC_CONCEPT_MATERIALIZER_ID = 'semantic-concept-materializer-v1';

export type SemanticConceptCandidate = {
  external_id: string;
  source?: string | null;
  topics?: string[];
  model_topics?: string[];
  content_type?: string | null;
};

export type DerivedGraphNodeSpec = Omit<GraphNode, 'createdAt' | 'updatedAt'>;
export type DerivedGraphEdgeSpec = Omit<GraphEdge, 'createdAt' | 'updatedAt'>;

export type SemanticConceptProposal = {
  id: string;
  kind: 'topic' | 'concept';
  label: string;
  confidence: number;
  sourceKinds: Array<'model_topic' | 'candidate_topic' | 'content_type' | 'title_phrase'>;
  supportCount: number;
  evidenceCount: number;
  contentNodeIds: string[];
  evidenceIds: string[];
};

export type SemanticConceptMaterializationOptions = {
  minimumContentSupport?: number;
  maxProposals?: number;
  maxSupportEdgesPerProposal?: number;
  maxCandidateTopics?: number;
};

export type SemanticConceptMaterializationResult = {
  marker: typeof SEMANTIC_CONCEPT_MATERIALIZER_ID;
  nodes: DerivedGraphNodeSpec[];
  edges: DerivedGraphEdgeSpec[];
  proposals: SemanticConceptProposal[];
  diagnostics: {
    interactionSupportedContentCount: number;
    candidateCount: number;
    candidateWithInteractionSupportCount: number;
    rawLabelCount: number;
    qualifiedBeforeCap: number;
    droppedByCap: number;
    qualifiedProposalCount: number;
    materializedNodeCount: number;
    materializedEdgeCount: number;
    skippedExplicitLabelCount: number;
  };
};

type SourceKind = SemanticConceptProposal['sourceKinds'][number];

type SupportEntry = {
  contentNodeId: string;
  externalId: string;
  evidenceIds: string[];
  evidenceConfidence: number;
};

type ProposalAccumulator = {
  kind: 'topic' | 'concept';
  normalizedLabel: string;
  labels: Map<string, number>;
  sourceKinds: Set<SourceKind>;
  supportByContent: Map<string, SupportEntry>;
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by',
  'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'of', 'on', 'or', 'our', 'so', 'than', 'that', 'the', 'their',
  'then', 'there', 'these', 'this', 'those', 'to', 'too', 'up', 'was', 'we',
  'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
  'you', 'your',
]);

const GENERIC_TITLE_TOKENS = new Set([
  'clip', 'episode', 'full', 'live', 'new', 'official', 'part', 'reaction',
  'reacts', 'short', 'shorts', 'trailer', 'video', 'videos',
]);

const SUPPORTED_INTERACTIONS = new Set(['clicked', 'watched', 'saved', 'shared']);

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const normalizedText = (value: string): string =>
  value.normalize('NFKC').replace(/\s+/g, ' ').trim();

const normalizeLabelKey = (value: string): string =>
  normalizedText(value).toLocaleLowerCase('en-US');

const sanitizeDisplayLabel = (value: string): string =>
  normalizedText(value).replace(/^[\s\-–—:|,.;]+|[\s\-–—:|,.;]+$/g, '');

const usableLabel = (value: string): boolean => {
  const label = sanitizeDisplayLabel(value);
  if (label.length < 3 || label.length > 80) return false;
  if (/^https?:\/\//i.test(label)) return false;
  if (/^\d+(?:[\s.,:/-]\d+)*$/.test(label)) return false;
  const words = label.split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 8;
};

const contentKey = (source: string, externalId: string): string =>
  `${source}:${externalId}`;

const contentNodeId = (source: string, externalId: string): string =>
  `content:${encodeURIComponent(source)}:${encodeURIComponent(externalId)}`;

const derivedNodeId = (kind: 'topic' | 'concept', normalizedLabel: string): string =>
  `${kind}:derived:${encodeURIComponent(normalizedLabel)}`;

const derivedEdgeId = (nodeId: string, supportedContentNodeId: string): string =>
  `edge:derived-about:${encodeURIComponent(nodeId)}:${encodeURIComponent(supportedContentNodeId)}`;

const titleTokens = (title: string): string[] =>
  normalizedText(title)
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}+#.]+/gu, ' ')
    .split(/\s+/)
    .filter((token) => (
      token.length >= 3
      && !STOP_WORDS.has(token)
      && !GENERIC_TITLE_TOKENS.has(token)
    ));

const titlePhrases = (title: string): string[] => {
  const tokens = titleTokens(title).slice(0, 18);
  const phrases = new Set<string>();
  for (const size of [3, 2]) {
    for (let index = 0; index + size <= tokens.length; index += 1) {
      const phrase = tokens.slice(index, index + size).join(' ');
      if (usableLabel(phrase)) phrases.add(phrase);
    }
  }
  return [...phrases].sort().slice(0, 24);
};

const chooseDisplayLabel = (labels: Map<string, number>): string =>
  [...labels.entries()]
    .sort((left, right) => (
      right[1] - left[1]
      || left[0].length - right[0].length
      || left[0].localeCompare(right[0])
    ))[0]?.[0] ?? '';

const proposalConfidence = (
  sourceKinds: Set<SourceKind>,
  supportCount: number,
): number => {
  const sourceBase = sourceKinds.has('model_topic')
    ? 0.82
    : sourceKinds.has('content_type')
      ? 0.72
      : sourceKinds.has('candidate_topic')
        ? 0.66
        : 0.54;
  const supportBoost = Math.min(0.2, Math.max(0, supportCount - 2) * 0.04);
  return Number(Math.min(0.92, sourceBase + supportBoost).toFixed(4));
};

export function buildSemanticConceptMaterialization(
  state: PersonalAlgorithmState,
  candidates: readonly SemanticConceptCandidate[],
  options: SemanticConceptMaterializationOptions = {},
): SemanticConceptMaterializationResult {
  const minimumContentSupport = Math.max(2, Math.floor(options.minimumContentSupport ?? 2));
  const maxProposals = Math.max(1, Math.floor(options.maxProposals ?? 64));
  const maxSupportEdgesPerProposal = Math.max(
    1,
    Math.floor(options.maxSupportEdgesPerProposal ?? 24),
  );
  const maxCandidateTopics = Math.max(1, Math.floor(options.maxCandidateTopics ?? 16));

  const interactionsByContent = new Map<string, SupportEntry>();
  for (const record of state.evidence) {
    if (
      record.evidence.kind !== 'interaction'
      || !SUPPORTED_INTERACTIONS.has(record.evidence.interaction)
    ) continue;

    const source = record.evidence.content.source;
    const externalId = record.evidence.content.externalId;
    const key = contentKey(source, externalId);
    const existing = interactionsByContent.get(key) ?? {
      contentNodeId: contentNodeId(source, externalId),
      externalId,
      evidenceIds: [],
      evidenceConfidence: 0,
    };
    existing.evidenceIds.push(record.id);
    existing.evidenceConfidence = Math.max(existing.evidenceConfidence, clamp01(record.confidence));
    interactionsByContent.set(key, existing);
  }

  for (const entry of interactionsByContent.values()) {
    entry.evidenceIds = [...new Set(entry.evidenceIds)].sort();
  }

  const explicitSemanticLabels = new Set(
    state.graph.nodes
      .filter((node) => (
        node.provenance === 'explicit'
        && (node.kind === 'topic' || node.kind === 'concept')
      ))
      .map((node) => `${node.kind}:${normalizeLabelKey(node.label)}`),
  );

  const accumulators = new Map<string, ProposalAccumulator>();
  const addLabel = (
    kind: 'topic' | 'concept',
    labelValue: string,
    sourceKind: SourceKind,
    support: SupportEntry,
    allowCreate = true,
  ) => {
    const label = sanitizeDisplayLabel(labelValue);
    if (!usableLabel(label)) return;
    const normalizedLabel = normalizeLabelKey(label);
    if (!normalizedLabel) return;
    const key = `${kind}:${normalizedLabel}`;
    const existing = accumulators.get(key);
    if (!existing && !allowCreate) return;
    const accumulator = existing ?? {
      kind,
      normalizedLabel,
      labels: new Map<string, number>(),
      sourceKinds: new Set<SourceKind>(),
      supportByContent: new Map<string, SupportEntry>(),
    };
    const labelWeight = sourceKind === 'title_phrase' ? 1 : 3;
    accumulator.labels.set(label, (accumulator.labels.get(label) ?? 0) + labelWeight);
    accumulator.sourceKinds.add(sourceKind);
    accumulator.supportByContent.set(support.contentNodeId, support);
    accumulators.set(key, accumulator);
  };

  let candidateWithInteractionSupportCount = 0;
  const supportedContentTypeLabels = new Set<string>();
  const sortedCandidates = [...candidates]
    .filter((candidate) => candidate.external_id?.trim())
    .sort((left, right) => (
      (left.source ?? 'youtube').localeCompare(right.source ?? 'youtube')
      || left.external_id.localeCompare(right.external_id)
    ));

  for (const candidate of sortedCandidates) {
    const source = candidate.source?.trim() || 'youtube';
    const support = interactionsByContent.get(contentKey(source, candidate.external_id));
    if (!support) continue;
    candidateWithInteractionSupportCount += 1;
    if (candidate.content_type?.trim()) {
      supportedContentTypeLabels.add(normalizeLabelKey(candidate.content_type));
    }
  }

  for (const candidate of sortedCandidates) {
    const source = candidate.source?.trim() || 'youtube';
    const support = interactionsByContent.get(contentKey(source, candidate.external_id));
    if (!support) continue;

    const hasVerifiedModelTopics = candidate.model_topics !== undefined;
    const modelTopics = (candidate.model_topics ?? [])
      .map((topic) => topic.trim())
      .filter(Boolean)
      .slice(0, maxCandidateTopics);
    const taxonomyTopics = hasVerifiedModelTopics
      ? modelTopics
      : (candidate.topics ?? []).slice(0, maxCandidateTopics);

    for (const topic of taxonomyTopics) {
      if (supportedContentTypeLabels.has(normalizeLabelKey(topic))) continue;
      addLabel(
        'topic',
        topic,
        hasVerifiedModelTopics ? 'model_topic' : 'candidate_topic',
        support,
      );
    }
    if (candidate.content_type?.trim()) {
      addLabel('concept', candidate.content_type, 'content_type', support);
    }
  }

  for (const record of state.evidence) {
    if (
      record.evidence.kind !== 'interaction'
      || !SUPPORTED_INTERACTIONS.has(record.evidence.interaction)
    ) continue;
    const title = record.evidence.metadata?.title?.trim();
    if (!title) continue;
    const support = interactionsByContent.get(contentKey(
      record.evidence.content.source,
      record.evidence.content.externalId,
    ));
    if (!support) continue;
    for (const phrase of titlePhrases(title)) {
      addLabel('topic', phrase, 'title_phrase', support, false);
    }
  }

  let skippedExplicitLabelCount = 0;
  const qualifiedBeforeCap = [...accumulators.values()]
    .filter((accumulator) => accumulator.supportByContent.size >= minimumContentSupport)
    .filter((accumulator) => {
      const blocked = explicitSemanticLabels.has(
        `${accumulator.kind}:${accumulator.normalizedLabel}`,
      );
      if (blocked) skippedExplicitLabelCount += 1;
      return !blocked;
    })
    .map((accumulator) => {
      const support = [...accumulator.supportByContent.values()]
        .sort((left, right) => (
          right.evidenceIds.length - left.evidenceIds.length
          || left.contentNodeId.localeCompare(right.contentNodeId)
        ));
      const label = chooseDisplayLabel(accumulator.labels);
      const confidence = proposalConfidence(
        accumulator.sourceKinds,
        accumulator.supportByContent.size,
      );
      const proposal: SemanticConceptProposal = {
        id: derivedNodeId(accumulator.kind, accumulator.normalizedLabel),
        kind: accumulator.kind,
        label,
        confidence,
        sourceKinds: [...accumulator.sourceKinds].sort(),
        supportCount: accumulator.supportByContent.size,
        evidenceCount: support.reduce((sum, entry) => sum + entry.evidenceIds.length, 0),
        contentNodeIds: support.map((entry) => entry.contentNodeId),
        evidenceIds: [...new Set(support.flatMap((entry) => entry.evidenceIds))].sort(),
      };
      return { proposal, support };
    })
    .sort((left, right) => (
      right.proposal.supportCount - left.proposal.supportCount
      || right.proposal.confidence - left.proposal.confidence
      || right.proposal.evidenceCount - left.proposal.evidenceCount
      || left.proposal.label.localeCompare(right.proposal.label)
      || left.proposal.id.localeCompare(right.proposal.id)
    ));
  const qualified = qualifiedBeforeCap.slice(0, maxProposals);

  const nodes: DerivedGraphNodeSpec[] = [];
  const edges: DerivedGraphEdgeSpec[] = [];
  const proposals: SemanticConceptProposal[] = [];

  for (const { proposal, support } of qualified) {
    proposals.push(proposal);
    nodes.push({
      id: proposal.id,
      kind: proposal.kind,
      label: proposal.label,
      content: null,
      provenance: 'inferred',
      confidence: proposal.confidence,
      attributes: {
        derivedBy: SEMANTIC_CONCEPT_MATERIALIZER_ID,
        rebuildable: true,
        normalizedLabel: normalizeLabelKey(proposal.label),
        sourceKinds: proposal.sourceKinds,
        supportCount: proposal.supportCount,
        evidenceCount: proposal.evidenceCount,
      },
    });

    for (const entry of support.slice(0, maxSupportEdgesPerProposal)) {
      edges.push({
        id: derivedEdgeId(proposal.id, entry.contentNodeId),
        sourceNodeId: proposal.id,
        targetNodeId: entry.contentNodeId,
        relation: 'about',
        provenance: 'inferred',
        confidence: Number(
          Math.min(proposal.confidence, entry.evidenceConfidence || proposal.confidence).toFixed(4),
        ),
        evidenceIds: entry.evidenceIds,
        attributes: {
          derivedBy: SEMANTIC_CONCEPT_MATERIALIZER_ID,
          rebuildable: true,
        },
      });
    }
  }

  nodes.sort((left, right) => left.id.localeCompare(right.id));
  edges.sort((left, right) => left.id.localeCompare(right.id));

  return {
    marker: SEMANTIC_CONCEPT_MATERIALIZER_ID,
    nodes,
    edges,
    proposals,
    diagnostics: {
      interactionSupportedContentCount: interactionsByContent.size,
      candidateCount: sortedCandidates.length,
      candidateWithInteractionSupportCount,
      rawLabelCount: accumulators.size,
      qualifiedBeforeCap: qualifiedBeforeCap.length,
      droppedByCap: Math.max(0, qualifiedBeforeCap.length - qualified.length),
      qualifiedProposalCount: qualified.length,
      materializedNodeCount: nodes.length,
      materializedEdgeCount: edges.length,
      skippedExplicitLabelCount,
    },
  };
}
