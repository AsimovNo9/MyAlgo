import type {
  CandidateModeAffinity,
  DurableSemanticMode,
  DurableSemanticModeCatalog,
  DurableSemanticModeMember,
  PersonalAlgorithmState,
  SemanticGraphMatch,
} from '@repo/shared-types';

import {
  buildCanonicalSemanticConcepts,
  type CanonicalSemanticBuildResult,
  type CanonicalSemanticConcept,
} from './canonical-semantic.ts';

export const DURABLE_SEMANTIC_MODE_PIPELINE_ID = 'durable-semantic-mode-cluster-v1';
export const DURABLE_MODE_AFFINITY_PIPELINE_ID = 'durable-mode-affinity-v3';

export type DurableSemanticModeProposal = {
  label: string;
  members: DurableSemanticModeMember[];
};

export type DurableSemanticModeClusterOptions = {
  minimumSupportPerConcept?: number;
  minimumSharedContent?: number;
  minimumSupportJaccard?: number;
  minimumMembers?: number;
  minimumSingletonSupport?: number;
};

export type DurableSemanticModeClusterResult = {
  marker: typeof DURABLE_SEMANTIC_MODE_PIPELINE_ID;
  proposals: DurableSemanticModeProposal[];
  assignmentByCanonicalId: Record<string, number>;
  diagnostics: {
    canonicalConceptCount: number;
    eligibleConceptCount: number;
    comparedPairCount: number;
    joinedPairCount: number;
    proposedModeCount: number;
    assignedConceptCount: number;
  };
};

export type DurableSemanticModeReconcileResult = {
  catalog: DurableSemanticModeCatalog;
  changed: boolean;
  diagnostics: {
    proposedModeCount: number;
    reusedModeCount: number;
    newModeCount: number;
    dormantModeCount: number;
    activeModeCount: number;
  };
};

class UnionFind {
  private readonly parent = new Map<string, string>();

  constructor(ids: readonly string[]) {
    ids.forEach((id) => this.parent.set(id, id));
  }

  find(id: string): string {
    const current = this.parent.get(id) ?? id;
    if (current === id) return current;
    const root = this.find(current);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string): boolean {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return false;
    const [first, second] = [leftRoot, rightRoot].sort();
    this.parent.set(second, first);
    return true;
  }
}

const setIntersectionSize = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number => {
  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let count = 0;
  for (const value of smaller) if (larger.has(value)) count += 1;
  return count;
};

const setJaccard = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number => {
  const intersection = setIntersectionSize(left, right);
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 1;
};

const fnv1a = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const modeIdForMembers = (canonicalIds: readonly string[]): string =>
  `mode:inferred:v1:${fnv1a([...canonicalIds].sort().join('|'))}`;

const contentSupportByCanonicalId = (
  state: PersonalAlgorithmState,
  canonical: Pick<CanonicalSemanticBuildResult, 'concepts' | 'assignmentByNodeId'>,
): Map<string, Set<string>> => {
  const support = new Map(canonical.concepts.map((concept) => [concept.id, new Set<string>()]));
  const nodeById = new Map(state.graph.nodes.map((node) => [node.id, node]));

  for (const edge of state.graph.edges) {
    if (edge.relation !== 'about') continue;
    const sourceCanonicalId = canonical.assignmentByNodeId[edge.sourceNodeId];
    const targetCanonicalId = canonical.assignmentByNodeId[edge.targetNodeId];
    const sourceNode = nodeById.get(edge.sourceNodeId);
    const targetNode = nodeById.get(edge.targetNodeId);

    if (sourceCanonicalId && targetNode?.kind === 'content') {
      support.get(sourceCanonicalId)?.add(edge.targetNodeId);
    }
    if (targetCanonicalId && sourceNode?.kind === 'content') {
      support.get(targetCanonicalId)?.add(edge.sourceNodeId);
    }
  }

  return support;
};

const representativeLabel = (
  concepts: readonly CanonicalSemanticConcept[],
  supportById: ReadonlyMap<string, ReadonlySet<string>>,
): string => (
  [...concepts].sort((left, right) => (
    (supportById.get(right.id)?.size ?? 0) - (supportById.get(left.id)?.size ?? 0)
    || right.evidenceIds.length - left.evidenceIds.length
    || Number(right.provenance === 'explicit') - Number(left.provenance === 'explicit')
    || left.label.length - right.label.length
    || left.id.localeCompare(right.id)
  ))[0]?.label ?? 'Inferred mode'
);

const proposalMembers = (
  concepts: readonly CanonicalSemanticConcept[],
  supportById: ReadonlyMap<string, ReadonlySet<string>>,
): DurableSemanticModeMember[] => {
  const maxSupport = Math.max(1, ...concepts.map((concept) => supportById.get(concept.id)?.size ?? 0));
  return concepts
    .map((concept) => {
      const supportContentIds = [...(supportById.get(concept.id) ?? [])].sort();
      return {
        canonicalId: concept.id,
        label: concept.label,
        weight: Number(Math.max(0.25, supportContentIds.length / maxSupport).toFixed(4)),
        sourceNodeIds: [...concept.sourceNodeIds].sort(),
        supportContentIds,
      };
    })
    .sort((left, right) => (
      right.weight - left.weight
      || left.canonicalId.localeCompare(right.canonicalId)
    ));
};

export function buildDurableSemanticModeClusters(
  state: PersonalAlgorithmState,
  canonicalInput?: CanonicalSemanticBuildResult,
  options: DurableSemanticModeClusterOptions = {},
): DurableSemanticModeClusterResult {
  const minimumSupportPerConcept = Math.max(1, Math.floor(options.minimumSupportPerConcept ?? 2));
  const minimumSharedContent = Math.max(1, Math.floor(options.minimumSharedContent ?? 2));
  const minimumSupportJaccard = Math.max(0, Math.min(1, options.minimumSupportJaccard ?? 0.5));
  const minimumMembers = Math.max(2, Math.floor(options.minimumMembers ?? 2));
  const minimumSingletonSupport = Math.max(
    minimumSupportPerConcept,
    Math.floor(options.minimumSingletonSupport ?? 3),
  );
  const canonical = canonicalInput ?? buildCanonicalSemanticConcepts(state);
  const supportById = contentSupportByCanonicalId(state, canonical);

  const eligible = canonical.concepts
    .filter((concept) => !concept.taxonomyOnly)
    .filter((concept) => !concept.kinds.every((kind) => kind === 'objective'))
    .filter((concept) => (supportById.get(concept.id)?.size ?? 0) >= minimumSupportPerConcept)
    .sort((left, right) => left.id.localeCompare(right.id));

  const unionFind = new UnionFind(eligible.map((concept) => concept.id));
  let comparedPairCount = 0;
  let joinedPairCount = 0;

  for (let leftIndex = 0; leftIndex < eligible.length; leftIndex += 1) {
    const left = eligible[leftIndex]!;
    const leftSupport = supportById.get(left.id) ?? new Set<string>();
    for (let rightIndex = leftIndex + 1; rightIndex < eligible.length; rightIndex += 1) {
      const right = eligible[rightIndex]!;
      const rightSupport = supportById.get(right.id) ?? new Set<string>();
      comparedPairCount += 1;
      const shared = setIntersectionSize(leftSupport, rightSupport);
      if (shared < minimumSharedContent) continue;
      if (setJaccard(leftSupport, rightSupport) < minimumSupportJaccard) continue;
      if (unionFind.union(left.id, right.id)) joinedPairCount += 1;
    }
  }

  const byRoot = new Map<string, CanonicalSemanticConcept[]>();
  for (const concept of eligible) {
    const root = unionFind.find(concept.id);
    const group = byRoot.get(root) ?? [];
    group.push(concept);
    byRoot.set(root, group);
  }

  const proposals = [...byRoot.values()]
    .filter((group) => (
      group.length >= minimumMembers
      || (
        group.length === 1
        && (supportById.get(group[0]!.id)?.size ?? 0) >= minimumSingletonSupport
      )
    ))
    .map((group) => ({
      label: representativeLabel(group, supportById),
      members: proposalMembers(group, supportById),
    }))
    .sort((left, right) => (
      left.label.localeCompare(right.label)
      || left.members[0]!.canonicalId.localeCompare(right.members[0]!.canonicalId)
    ));

  const assignmentByCanonicalId: Record<string, number> = {};
  proposals.forEach((proposal, proposalIndex) => {
    for (const member of proposal.members) assignmentByCanonicalId[member.canonicalId] = proposalIndex;
  });

  return {
    marker: DURABLE_SEMANTIC_MODE_PIPELINE_ID,
    proposals,
    assignmentByCanonicalId,
    diagnostics: {
      canonicalConceptCount: canonical.concepts.length,
      eligibleConceptCount: eligible.length,
      comparedPairCount,
      joinedPairCount,
      proposedModeCount: proposals.length,
      assignedConceptCount: Object.keys(assignmentByCanonicalId).length,
    },
  };
}

const memberIdSet = (mode: Pick<DurableSemanticMode, 'members'>): Set<string> =>
  new Set(mode.members.map((member) => member.canonicalId));

const proposalMemberIdSet = (proposal: DurableSemanticModeProposal): Set<string> =>
  new Set(proposal.members.map((member) => member.canonicalId));

const memberSignature = (members: readonly DurableSemanticModeMember[]): string =>
  JSON.stringify([...members]
    .map((member) => ({
      canonicalId: member.canonicalId,
      label: member.label,
      weight: member.weight,
      sourceNodeIds: [...member.sourceNodeIds].sort(),
      supportContentIds: [...member.supportContentIds].sort(),
    }))
    .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId)));

const modeSemanticSignature = (mode: DurableSemanticMode): string =>
  JSON.stringify({
    id: mode.id,
    inferredLabel: mode.inferredLabel ?? mode.label,
    revision: mode.revision,
    members: memberSignature(mode.members),
    provenance: mode.provenance,
    pipelineId: mode.pipelineId,
    graphRevision: mode.graphRevision,
    createdAt: mode.createdAt,
    lastSupportedAt: mode.lastSupportedAt,
    active: mode.active,
    pinned: mode.pinned,
  });

const catalogSignature = (catalog: DurableSemanticModeCatalog | null | undefined): string =>
  JSON.stringify({
    pipelineId: catalog?.pipelineId ?? null,
    graphRevision: catalog?.graphRevision ?? null,
    modes: [...(catalog?.modes ?? [])]
      .map(modeSemanticSignature)
      .sort(),
  });

export function reconcileDurableSemanticModes(
  previous: DurableSemanticModeCatalog | null | undefined,
  proposals: readonly DurableSemanticModeProposal[],
  graphRevision: number,
  generatedAt: string,
  options: {
    minimumIdentityJaccard?: number;
    maxModes?: number;
  } = {},
): DurableSemanticModeReconcileResult {
  const minimumIdentityJaccard = Math.max(0, Math.min(1, options.minimumIdentityJaccard ?? 0.5));
  const maxModes = Math.max(1, Math.floor(options.maxModes ?? 12));
  const previousModes = [...(previous?.modes ?? [])]
    .filter((mode) => mode.pipelineId === DURABLE_SEMANTIC_MODE_PIPELINE_ID)
    .sort((left, right) => left.id.localeCompare(right.id));

  const candidates: Array<{
    proposalIndex: number;
    previousIndex: number;
    jaccard: number;
    overlap: number;
  }> = [];
  proposals.forEach((proposal, proposalIndex) => {
    const proposalIds = proposalMemberIdSet(proposal);
    previousModes.forEach((mode, previousIndex) => {
      const previousIds = memberIdSet(mode);
      const overlap = setIntersectionSize(proposalIds, previousIds);
      if (overlap === 0) return;
      const jaccard = setJaccard(proposalIds, previousIds);
      if (jaccard < minimumIdentityJaccard) return;
      candidates.push({ proposalIndex, previousIndex, jaccard, overlap });
    });
  });
  candidates.sort((left, right) => (
    right.jaccard - left.jaccard
    || right.overlap - left.overlap
    || proposals[left.proposalIndex]!.label.localeCompare(proposals[right.proposalIndex]!.label)
    || previousModes[left.previousIndex]!.id.localeCompare(previousModes[right.previousIndex]!.id)
  ));

  const matchedProposal = new Map<number, number>();
  const matchedPrevious = new Set<number>();
  for (const candidate of candidates) {
    if (matchedProposal.has(candidate.proposalIndex) || matchedPrevious.has(candidate.previousIndex)) continue;
    matchedProposal.set(candidate.proposalIndex, candidate.previousIndex);
    matchedPrevious.add(candidate.previousIndex);
  }

  let reusedModeCount = 0;
  let newModeCount = 0;
  const activeModes = proposals.map((proposal, proposalIndex): DurableSemanticMode => {
    const previousIndex = matchedProposal.get(proposalIndex);
    const prior = previousIndex == null ? undefined : previousModes[previousIndex];
    if (prior) reusedModeCount += 1;
    else newModeCount += 1;

    const id = prior?.id ?? modeIdForMembers(proposal.members.map((member) => member.canonicalId));
    const semanticChanged = !prior
      || memberSignature(prior.members) !== memberSignature(proposal.members)
      || prior.active !== true;

    return {
      id,
      label: proposal.label,
      inferredLabel: proposal.label,
      revision: prior ? prior.revision + Number(semanticChanged) : 1,
      members: proposal.members.map((member) => ({
        ...member,
        sourceNodeIds: [...member.sourceNodeIds],
        supportContentIds: [...member.supportContentIds],
      })),
      provenance: 'inferred',
      pipelineId: DURABLE_SEMANTIC_MODE_PIPELINE_ID,
      graphRevision,
      createdAt: prior?.createdAt ?? generatedAt,
      lastSupportedAt: prior && !semanticChanged ? prior.lastSupportedAt : generatedAt,
      active: true,
      pinned: prior?.pinned ?? false,
    };
  });

  const dormantModes = previousModes
    .filter((_mode, index) => !matchedPrevious.has(index))
    .map((prior): DurableSemanticMode => ({
      ...prior,
      revision: prior.revision + Number(prior.active),
      graphRevision,
      active: false,
    }));

  const modes = [...activeModes, ...dormantModes]
    .sort((left, right) => (
      // A user-selected/pinned mode is durable UI state. Keep it in the catalog
      // even if a fresh clustering pass makes it dormant or introduces a broader
      // parent cluster with newer support.
      Number(right.pinned) - Number(left.pinned)
      || Number(right.active) - Number(left.active)
      || right.lastSupportedAt.localeCompare(left.lastSupportedAt)
      || left.id.localeCompare(right.id)
    ))
    .slice(0, maxModes);

  const candidateCatalog: DurableSemanticModeCatalog = {
    pipelineId: DURABLE_SEMANTIC_MODE_PIPELINE_ID,
    graphRevision,
    generatedAt,
    modes,
  };
  const changed = catalogSignature(previous) !== catalogSignature(candidateCatalog);
  const catalog = changed || !previous
    ? candidateCatalog
    : previous;

  return {
    catalog,
    changed,
    diagnostics: {
      proposedModeCount: proposals.length,
      reusedModeCount,
      newModeCount,
      dormantModeCount: modes.filter((mode) => !mode.active).length,
      activeModeCount: modes.filter((mode) => mode.active).length,
    },
  };
}

export function buildCandidateModeAffinities(
  matches: readonly SemanticGraphMatch[] | null | undefined,
  catalog: DurableSemanticModeCatalog | null | undefined,
  options: {
    minimumMemberSimilarity?: number;
    minimumModeAffinity?: number;
    maxAffinities?: number;
    includeDormant?: boolean;
    includeModeIds?: readonly string[];
  } = {},
): CandidateModeAffinity[] {
  const minimumMemberSimilarity = Math.max(
    0,
    Math.min(1, options.minimumMemberSimilarity ?? 0.35),
  );
  // Live PR #224 validation showed obvious cross-domain false positives in the
  // 0.35-0.40 weighted-affinity band while grounded controls were >= ~0.51.
  // Keep the raw member floor permissive for provenance/coverage, but abstain
  // from exposing the durable mode unless the final weighted signal is strong.
  // This is a provisional replay/live regression threshold, not a calibrated
  // encoder constant.
  const minimumModeAffinity = Math.max(
    0,
    Math.min(1, options.minimumModeAffinity ?? 0.45),
  );
  const maxAffinities = Math.max(1, Math.floor(options.maxAffinities ?? 4));
  const includeDormant = options.includeDormant === true;
  const includedModeIds = new Set(
    (options.includeModeIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const usableMatches = (matches ?? [])
    .filter((match) => !match.taxonomy_only && Number.isFinite(match.similarity));

  const affinities: CandidateModeAffinity[] = [];
  for (const mode of catalog?.modes ?? []) {
    if (!mode.active && !includeDormant && !includedModeIds.has(mode.id)) continue;
    const memberHits: Array<{
      canonicalId: string;
      label: string;
      memberWeight: number;
      similarity: number;
      affinity: number;
      sourceNodeIds: string[];
    }> = [];

    for (const member of mode.members) {
      const memberSources = new Set(member.sourceNodeIds);
      const match = usableMatches
        .filter((candidateMatch) => (
          candidateMatch.canonical_id === member.canonicalId
          || (candidateMatch.source_node_ids ?? []).some((nodeId) => memberSources.has(nodeId))
        ))
        .sort((left, right) => (
          right.similarity - left.similarity
          || left.node_id.localeCompare(right.node_id)
        ))[0];
      if (!match || match.similarity < minimumMemberSimilarity) continue;
      memberHits.push({
        canonicalId: member.canonicalId,
        label: member.label,
        memberWeight: member.weight,
        similarity: Math.max(0, Math.min(1, match.similarity)),
        affinity: Math.max(0, Math.min(1, match.similarity * member.weight)),
        sourceNodeIds: [...new Set([
          ...member.sourceNodeIds,
          ...(match.source_node_ids ?? [match.node_id]),
        ])].sort(),
      });
    }

    if (memberHits.length === 0) continue;
    const affinity = Math.max(...memberHits.map((hit) => hit.affinity));
    if (affinity < minimumModeAffinity) continue;
    affinities.push({
      modeId: mode.id,
      modeRevision: mode.revision,
      label: mode.label,
      affinity: Number(affinity.toFixed(4)),
      matchedCanonicalIds: memberHits.map((hit) => hit.canonicalId).sort(),
      sourceNodeIds: [...new Set(memberHits.flatMap((hit) => hit.sourceNodeIds))].sort(),
      memberAffinities: memberHits
        .map((hit) => ({
          canonicalId: hit.canonicalId,
          label: hit.label,
          memberWeight: Number(hit.memberWeight.toFixed(4)),
          similarity: Number(hit.similarity.toFixed(4)),
          weightedAffinity: Number(hit.affinity.toFixed(4)),
          sourceNodeIds: [...hit.sourceNodeIds],
        }))
        .sort((left, right) => (
          right.weightedAffinity - left.weightedAffinity
          || left.canonicalId.localeCompare(right.canonicalId)
        )),
    });
  }

  return affinities
    .sort((left, right) => (
      right.affinity - left.affinity
      || left.modeId.localeCompare(right.modeId)
    ))
    .slice(0, maxAffinities);
}

export function resolveDurableMode(
  catalog: DurableSemanticModeCatalog | null | undefined,
  modeId: string | null | undefined,
): DurableSemanticMode | null {
  const normalized = modeId?.trim();
  if (!normalized || normalized === 'default') return null;
  return catalog?.modes.find((mode) => mode.id === normalized) ?? null;
}
