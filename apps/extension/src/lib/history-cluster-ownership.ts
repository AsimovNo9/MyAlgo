import type { PersonalAlgorithmState } from '@repo/shared-types';
import type { HistoryEvidence } from '../content-scripts/youtube-history';

export const HISTORY_CLUSTER_PIPELINE_ID = 'history-clusters-v1';
export const HISTORY_CLUSTER_OWNERSHIP_SCHEMA_VERSION = 1 as const;
export const MAX_HISTORY_CLUSTER_REVISIONS = 50;

export type HistoryCluster = {
  id: string;
  label: string;
  externalIds: string[];
  evidenceIds: string[];
  creatorLabels: string[];
  keywords: string[];
  size: number;
};

export type HistoryClusterCatalog = {
  pipelineId: typeof HISTORY_CLUSTER_PIPELINE_ID;
  generatedAt: string;
  historyCount: number;
  clusters: HistoryCluster[];
};

export type HistoryClusterOwnershipRevision = {
  revision: number;
  createdAt: string;
  action: 'select_clusters' | 'include_all' | 'undo';
  before: { selectionMode: 'all' | 'selected'; selectedClusterIds: string[] };
  after: { selectionMode: 'all' | 'selected'; selectedClusterIds: string[] };
  revertsRevision?: number | null;
};

export type HistoryClusterOwnershipState = {
  schemaVersion: typeof HISTORY_CLUSTER_OWNERSHIP_SCHEMA_VERSION;
  currentRevision: number;
  selectionMode: 'all' | 'selected';
  selectedClusterIds: string[];
  revisions: HistoryClusterOwnershipRevision[];
};

const STOP_WORDS = new Set([
  'about','after','again','also','and','are','but','can','for','from','get','how','into','its','just',
  'more','new','not','now','off','one','out','part','the','this','that','their','them','then','there',
  'these','they','to','too','use','using','video','videos','watch','what','when','where','which','who',
  'why','with','you','your','youtube','official','episode','full','shorts','live',
]);

const normalizeText = (value: string): string => value
  .normalize('NFKD')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const titleTokens = (value: string): string[] => [...new Set(
  normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token) && !/^\d+$/.test(token))
    .slice(0, 12),
)];

const hash = (value: string): string => {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const evidenceId = (externalId: string): string => `interaction:watched:${externalId}:history`;

const displayToken = (token: string): string => token
  .split(' ')
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

const cleanIds = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean))]
    .sort()
  : [];

export const createEmptyHistoryClusterOwnership = (): HistoryClusterOwnershipState => ({
  schemaVersion: HISTORY_CLUSTER_OWNERSHIP_SCHEMA_VERSION,
  currentRevision: 0,
  selectionMode: 'all',
  selectedClusterIds: [],
  revisions: [],
});

export const normalizeHistoryClusterOwnership = (value: unknown): HistoryClusterOwnershipState => {
  if (!value || typeof value !== 'object') return createEmptyHistoryClusterOwnership();
  const raw = value as Partial<HistoryClusterOwnershipState>;
  if (Number(raw.schemaVersion) !== HISTORY_CLUSTER_OWNERSHIP_SCHEMA_VERSION) {
    return createEmptyHistoryClusterOwnership();
  }
  const selectedClusterIds = cleanIds(raw.selectedClusterIds);
  const selectionMode = raw.selectionMode === 'selected' ? 'selected' : 'all';
  const revisions = Array.isArray(raw.revisions)
    ? raw.revisions
      .filter((entry): entry is HistoryClusterOwnershipRevision => (
        Boolean(entry)
        && Number.isInteger(entry.revision)
        && typeof entry.createdAt === 'string'
        && ['select_clusters', 'include_all', 'undo'].includes(entry.action)
      ))
      .slice(-MAX_HISTORY_CLUSTER_REVISIONS)
      .map((entry) => ({
        ...entry,
        before: {
          selectionMode: (entry.before?.selectionMode === 'selected' ? 'selected' : 'all') as 'all' | 'selected',
          selectedClusterIds: cleanIds(entry.before?.selectedClusterIds),
        },
        after: {
          selectionMode: (entry.after?.selectionMode === 'selected' ? 'selected' : 'all') as 'all' | 'selected',
          selectedClusterIds: cleanIds(entry.after?.selectedClusterIds),
        },
        revertsRevision: Number.isInteger(entry.revertsRevision) ? entry.revertsRevision : null,
      }))
    : [];
  return {
    schemaVersion: HISTORY_CLUSTER_OWNERSHIP_SCHEMA_VERSION,
    currentRevision: Math.max(
      Number.isInteger(raw.currentRevision) ? Number(raw.currentRevision) : 0,
      revisions.at(-1)?.revision ?? 0,
    ),
    selectionMode,
    selectedClusterIds: selectionMode === 'selected' ? selectedClusterIds : [],
    revisions,
  };
};

const snapshot = (state: HistoryClusterOwnershipState) => ({
  selectionMode: state.selectionMode,
  selectedClusterIds: [...state.selectedClusterIds],
});

const appendRevision = (
  state: HistoryClusterOwnershipState,
  action: HistoryClusterOwnershipRevision['action'],
  before: ReturnType<typeof snapshot>,
  after: ReturnType<typeof snapshot>,
  now: string,
  revertsRevision: number | null = null,
): HistoryClusterOwnershipState => {
  const revision = state.currentRevision + 1;
  return {
    ...state,
    currentRevision: revision,
    revisions: [
      ...state.revisions,
      { revision, createdAt: now, action, before, after, revertsRevision },
    ].slice(-MAX_HISTORY_CLUSTER_REVISIONS),
  };
};

export const selectHistoryClusters = (
  input: HistoryClusterOwnershipState,
  clusterIds: readonly string[],
  now = new Date().toISOString(),
): HistoryClusterOwnershipState => {
  const state = normalizeHistoryClusterOwnership(input);
  const ids = cleanIds(clusterIds);
  const before = snapshot(state);
  const next: HistoryClusterOwnershipState = {
    ...state,
    selectionMode: 'selected',
    selectedClusterIds: ids,
  };
  const after = snapshot(next);
  if (JSON.stringify(before) === JSON.stringify(after)) return state;
  return appendRevision(next, 'select_clusters', before, after, now);
};

export const includeAllHistoryClusters = (
  input: HistoryClusterOwnershipState,
  now = new Date().toISOString(),
): HistoryClusterOwnershipState => {
  const state = normalizeHistoryClusterOwnership(input);
  const before = snapshot(state);
  const next: HistoryClusterOwnershipState = {
    ...state,
    selectionMode: 'all',
    selectedClusterIds: [],
  };
  const after = snapshot(next);
  if (JSON.stringify(before) === JSON.stringify(after)) return state;
  return appendRevision(next, 'include_all', before, after, now);
};

export const undoHistoryClusterOwnership = (
  input: HistoryClusterOwnershipState,
  now = new Date().toISOString(),
): { state: HistoryClusterOwnershipState; reverted: HistoryClusterOwnershipRevision | null } => {
  const state = normalizeHistoryClusterOwnership(input);
  const revertedIds = new Set(
    state.revisions
      .filter((entry) => entry.action === 'undo' && Number.isInteger(entry.revertsRevision))
      .map((entry) => entry.revertsRevision as number),
  );
  const target = [...state.revisions]
    .reverse()
    .find((entry) => entry.action !== 'undo' && !revertedIds.has(entry.revision));
  if (!target) return { state, reverted: null };

  const restored: HistoryClusterOwnershipState = {
    ...state,
    selectionMode: target.before.selectionMode,
    selectedClusterIds: [...target.before.selectedClusterIds],
  };
  return {
    state: appendRevision(restored, 'undo', snapshot(state), snapshot(restored), now, target.revision),
    reverted: target,
  };
};

export const buildHistoryClusterCatalog = (
  history: readonly HistoryEvidence[],
  generatedAt = new Date().toISOString(),
  previousCatalog: HistoryClusterCatalog | null = null,
): HistoryClusterCatalog => {
  const items = history
    .filter((item) => item?.externalId && item.title)
    .map((item) => ({
      item,
      tokens: titleTokens(item.title),
      creatorKey: normalizeText(item.creator ?? ''),
    }));

  const parent = items.map((_item, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]!]!;
      current = parent[current]!;
    }
    return current;
  };
  const union = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };

  const creatorBuckets = new Map<string, number[]>();
  const tokenBuckets = new Map<string, number[]>();
  items.forEach((entry, index) => {
    if (entry.creatorKey) {
      const group = creatorBuckets.get(entry.creatorKey) ?? [];
      group.push(index);
      creatorBuckets.set(entry.creatorKey, group);
    }
    for (const token of entry.tokens) {
      const group = tokenBuckets.get(token) ?? [];
      group.push(index);
      tokenBuckets.set(token, group);
    }
  });

  for (const group of creatorBuckets.values()) {
    for (let index = 1; index < group.length; index += 1) union(group[0]!, group[index]!);
  }

  const pairOverlap = new Map<string, number>();
  for (const group of tokenBuckets.values()) {
    if (group.length > 80) continue;
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        const a = group[left]!;
        const b = group[right]!;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        pairOverlap.set(key, (pairOverlap.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, overlap] of pairOverlap) {
    if (overlap < 2) continue;
    const [left, right] = key.split(':').map(Number);
    const unionSize = new Set([...items[left]!.tokens, ...items[right]!.tokens]).size;
    if (unionSize > 0 && overlap / unionSize >= 0.2) union(left!, right!);
  }

  const components = new Map<number, typeof items>();
  items.forEach((entry, index) => {
    const root = find(index);
    const group = components.get(root) ?? [];
    group.push(entry);
    components.set(root, group);
  });

  const grouped = [...components.values()]
    .filter((group) => group.length >= 2)
    .sort((left, right) => right.length - left.length
      || left[0]!.item.externalId.localeCompare(right[0]!.item.externalId));

  const clusteredIds = new Set(grouped.flatMap((group) => group.map((entry) => entry.item.externalId)));
  const remainder = items.filter((entry) => !clusteredIds.has(entry.item.externalId));
  const primary = grouped.slice(0, 23);
  const overflow = grouped.slice(23).flat();
  if (remainder.length > 0 || overflow.length > 0) primary.push([...remainder, ...overflow]);

  const provisionalClusters = primary.map((group, clusterIndex): HistoryCluster => {
    const externalIds = [...new Set(group.map((entry) => entry.item.externalId))].sort();
    const creators = [...new Set(group
      .map((entry) => entry.item.creator?.trim() ?? '')
      .filter(Boolean))]
      .sort();
    const tokenCounts = new Map<string, number>();
    for (const entry of group) {
      for (const token of entry.tokens) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }
    const keywords = [...tokenCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3)
      .map(([token]) => token);
    const isRemainder = clusterIndex === primary.length - 1 && (
      remainder.length > 0 || overflow.length > 0
    );
    const label = isRemainder
      ? 'Other history'
      : keywords.length > 0
        ? keywords.map(displayToken).join(' · ')
        : creators[0] ?? 'History cluster';
    return {
      id: `history:cluster:v1:${hash(externalIds.join('|'))}`,
      label,
      externalIds,
      evidenceIds: externalIds.map(evidenceId),
      creatorLabels: creators.slice(0, 4),
      keywords,
      size: externalIds.length,
    };
  });

  const previous = (previousCatalog?.pipelineId === HISTORY_CLUSTER_PIPELINE_ID
    ? previousCatalog.clusters
    : []
  ).map((cluster) => ({
    cluster,
    ids: new Set(cluster.externalIds),
  }));
  const usedPreviousIds = new Set<string>();
  const clusters = provisionalClusters.map((cluster) => {
    const currentIds = new Set(cluster.externalIds);
    const best = previous
      .filter((entry) => !usedPreviousIds.has(entry.cluster.id))
      .map((entry) => {
        let overlap = 0;
        for (const id of currentIds) if (entry.ids.has(id)) overlap += 1;
        const unionSize = new Set([...currentIds, ...entry.ids]).size;
        return {
          cluster: entry.cluster,
          overlap,
          jaccard: unionSize > 0 ? overlap / unionSize : 0,
        };
      })
      .filter((entry) => entry.overlap > 0 && entry.jaccard >= 0.5)
      .sort((left, right) => (
        right.jaccard - left.jaccard
        || right.overlap - left.overlap
        || left.cluster.id.localeCompare(right.cluster.id)
      ))[0];
    if (!best) return cluster;
    usedPreviousIds.add(best.cluster.id);
    return { ...cluster, id: best.cluster.id };
  });

  return {
    pipelineId: HISTORY_CLUSTER_PIPELINE_ID,
    generatedAt,
    historyCount: items.length,
    clusters,
  };
};

export const selectedHistoryEvidenceIds = (
  catalog: HistoryClusterCatalog | null | undefined,
  ownershipInput: HistoryClusterOwnershipState | null | undefined,
): Set<string> | null => {
  if (!catalog) return null;
  const ownership = normalizeHistoryClusterOwnership(ownershipInput);
  if (ownership.selectionMode === 'all') return null;
  const selected = new Set(ownership.selectedClusterIds);
  return new Set(
    catalog.clusters
      .filter((cluster) => selected.has(cluster.id))
      .flatMap((cluster) => cluster.evidenceIds),
  );
};

const isHistoryEvidenceRecord = (record: PersonalAlgorithmState['evidence'][number]): boolean => (
  record.evidence.kind === 'interaction'
  && record.evidence.interaction === 'watched'
  && record.evidence.provenance.mechanism === 'history_dom'
);

const projectGraph = (
  state: PersonalAlgorithmState,
  allowedHistoryEvidenceIds: Set<string> | null,
): PersonalAlgorithmState['graph'] => {
  if (allowedHistoryEvidenceIds == null) return state.graph;
  const excludedHistoryIds = new Set(
    state.evidence
      .filter((record) => isHistoryEvidenceRecord(record) && !allowedHistoryEvidenceIds.has(record.id))
      .map((record) => record.id),
  );
  if (excludedHistoryIds.size === 0) return state.graph;
  const edges = state.graph.edges
    .map((edge) => ({
      ...edge,
      evidenceIds: edge.evidenceIds.filter((id) => !excludedHistoryIds.has(id)),
    }))
    .filter((edge) => edge.provenance !== 'inferred' || edge.evidenceIds.length > 0);
  return { ...state.graph, edges };
};

export const projectHistoryOwnershipForScoring = (
  state: PersonalAlgorithmState,
  catalog: HistoryClusterCatalog | null | undefined,
  ownership: HistoryClusterOwnershipState | null | undefined,
): PersonalAlgorithmState => {
  const allowed = selectedHistoryEvidenceIds(catalog, ownership);
  if (allowed == null) return state;
  return {
    ...state,
    evidence: state.evidence.filter((record) => (
      !isHistoryEvidenceRecord(record) || allowed.has(record.id)
    )),
    graph: projectGraph(state, allowed),
  };
};

export const projectHistoryOwnershipForInspection = (
  state: PersonalAlgorithmState,
  catalog: HistoryClusterCatalog | null | undefined,
  ownership: HistoryClusterOwnershipState | null | undefined,
): PersonalAlgorithmState => {
  const allowed = selectedHistoryEvidenceIds(catalog, ownership);
  if (allowed == null) return state;
  return {
    ...state,
    graph: projectGraph(state, allowed),
  };
};
