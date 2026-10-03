import React from 'react';
import { PRIVACY_DISCLOSURE, PRIVACY_DISCLOSURE_VERSION, isPrivacyDisclosureAccepted } from '../lib/privacy';
import {
  applyDurableModeLabelsToGraphInspector,
  buildDurableModeOptions,
  buildExplanationGraphView,
  buildGraphInspectorView,
  buildGraphModeOverlay,
  parseGraphInspectorExport,
  summarizeGraphGroupCoverage,
  type ContentExplanation,
  type GraphInspectorSemanticContext,
  type GraphInspectorView,
} from '../lib/extension-helpers';
import { GraphCanvas } from '../components/GraphCanvas';
import type { DurableSemanticModeCatalog } from '@repo/shared-types';
import type {
  HistoryClusterCatalog,
  HistoryClusterOwnershipState,
} from '../lib/history-cluster-ownership';

export function Options() {
  const [mode, setMode] = React.useState('Default');
  const [activeModeId, setActiveModeId] = React.useState('default');
  const [selectedModeIds, setSelectedModeIds] = React.useState<string[]>([]);
  const [modeSearch, setModeSearch] = React.useState('');
  const [modeNameDrafts, setModeNameDrafts] = React.useState<Record<string, string>>({});
  const [modeMemberDrafts, setModeMemberDrafts] = React.useState<Record<string, string>>({});
  const [modeConfigRevision, setModeConfigRevision] = React.useState(0);
  const [durableModeCatalog, setDurableModeCatalog] = React.useState<DurableSemanticModeCatalog | null>(null);
  const [historyObservationEnabled, setHistoryObservationEnabled] = React.useState(false);
  const [historyClusterCatalog, setHistoryClusterCatalog] = React.useState<HistoryClusterCatalog | null>(null);
  const [historyClusterOwnership, setHistoryClusterOwnership] = React.useState<HistoryClusterOwnershipState | null>(null);
  const [historyClusterSearch, setHistoryClusterSearch] = React.useState('');
  const [homeObservationEnabled, setHomeObservationEnabled] = React.useState(false);
  const [semanticModelMode, setSemanticModelMode] = React.useState<'hash' | 'neural'>('hash');
  const [transcriptEnrichmentEnabled, setTranscriptEnrichmentEnabled] = React.useState(false);
  const [neuralBatchSize, setNeuralBatchSize] = React.useState(1);
  const [semanticModelStatus, setSemanticModelStatus] = React.useState<{
    status?: string;
    progress?: number | null;
    backend?: string;
    file?: string | null;
  } | null>(null);
  const [conceptModelStatus, setConceptModelStatus] = React.useState<{
    status?: string;
    progress?: number | null;
    backend?: string;
    file?: string | null;
    item?: number | null;
    itemCount?: number | null;
    error?: string | null;
  } | null>(null);
  const [disclosureAccepted, setDisclosureAccepted] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [graphInspector, setGraphInspector] = React.useState<GraphInspectorView | null>(null);
  const [graphInspectorSource, setGraphInspectorSource] = React.useState<'live' | 'offline' | null>(null);
  const [graphQuery, setGraphQuery] = React.useState('');
  const [graphModeId, setGraphModeId] = React.useState('all');
  const [graphFocusOnly, setGraphFocusOnly] = React.useState(true);
  const [graphLayoutMode, setGraphLayoutMode] = React.useState<'network' | 'lineage'>('network');
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = React.useState<string | null>(null);
  const [contentExplanation, setContentExplanation] = React.useState<ContentExplanation | null>(null);
  const [contentExplanationLoading, setContentExplanationLoading] = React.useState(false);
  const [contentExplanationError, setContentExplanationError] = React.useState<string | null>(null);
  const [offlineGraphJson, setOfflineGraphJson] = React.useState('');
  const graphInspectorDetailRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!selectedNodeId && !selectedEdgeId) return;
    const frame = window.requestAnimationFrame(() => {
      graphInspectorDetailRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
      graphInspectorDetailRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedNodeId, selectedEdgeId]);

  React.useEffect(() => {
    chrome.storage.local.get([
      'personal-algorithm-mode',
      'personal-algorithm-active-mode-id',
      'personal-algorithm-active-mode-ids',
      'personal-algorithm-durable-mode-catalog',
      'personal-algorithm-durable-mode-user-config',
      'personal-algorithm-history-observation-enabled',
      'personal-algorithm-home-observation-enabled',
      'personal-algorithm-semantic-model-mode',
      'personal-algorithm-transcript-enrichment-enabled',
      'personal-algorithm-semantic-model-status',
      'personal-algorithm-concept-model-status',
      'personal-algorithm-semantic-neural-batch-size',
      'personal-algorithm-privacy-disclosure-accepted-version',
    ]).then((result) => {
      const storedMode = (result['personal-algorithm-mode'] as string) ?? 'Default';
      const catalog = (result['personal-algorithm-durable-mode-catalog'] as DurableSemanticModeCatalog | undefined) ?? null;
      const storedModeId = (result['personal-algorithm-active-mode-id'] as string | undefined)
        ?? catalog?.modes.find((entry) => entry.label.toLowerCase() === storedMode.toLowerCase())?.id
        ?? (storedMode.toLowerCase() === 'default' ? 'default' : storedMode);
      setMode(storedMode);
      setActiveModeId(storedModeId);
      const storedModeIds = result['personal-algorithm-active-mode-ids'] as string[] | undefined;
      setSelectedModeIds(Array.isArray(storedModeIds)
        ? storedModeIds
        : storedModeId !== 'default' ? [storedModeId] : []);
      setDurableModeCatalog(catalog);
      const modeUserConfig = result['personal-algorithm-durable-mode-user-config'] as { currentRevision?: number } | undefined;
      setModeConfigRevision(Number.isInteger(modeUserConfig?.currentRevision) ? Number(modeUserConfig?.currentRevision) : 0);
      setHistoryObservationEnabled(result['personal-algorithm-history-observation-enabled'] === true);
      setHomeObservationEnabled(result['personal-algorithm-home-observation-enabled'] === true);
      setSemanticModelMode(result['personal-algorithm-semantic-model-mode'] === 'neural' ? 'neural' : 'hash');
      setTranscriptEnrichmentEnabled(result['personal-algorithm-transcript-enrichment-enabled'] === true);
      setSemanticModelStatus((result['personal-algorithm-semantic-model-status'] as typeof semanticModelStatus) ?? null);
      setConceptModelStatus((result['personal-algorithm-concept-model-status'] as typeof conceptModelStatus) ?? null);
      const storedBatchSize = Number(result['personal-algorithm-semantic-neural-batch-size'] ?? 1);
      setNeuralBatchSize(Number.isFinite(storedBatchSize) ? Math.max(1, Math.min(16, Math.floor(storedBatchSize))) : 1);
      setDisclosureAccepted(isPrivacyDisclosureAccepted(result['personal-algorithm-privacy-disclosure-accepted-version']));
    });
    void chrome.runtime.sendMessage({ type: 'GET_HISTORY_CLUSTER_OWNERSHIP' }).then((response: {
      ok?: boolean;
      catalog?: HistoryClusterCatalog;
      ownership?: HistoryClusterOwnershipState;
    }) => {
      if (!response?.ok) return;
      setHistoryClusterCatalog(response.catalog ?? null);
      setHistoryClusterOwnership(response.ownership ?? null);
    }).catch(() => undefined);
    const handleStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      const change = changes['personal-algorithm-semantic-model-status'];
      if (change) {
        setSemanticModelStatus((change.newValue as typeof semanticModelStatus) ?? null);
      }
      const transcriptChange = changes['personal-algorithm-transcript-enrichment-enabled'];
      if (transcriptChange) setTranscriptEnrichmentEnabled(transcriptChange.newValue === true);
      const conceptChange = changes['personal-algorithm-concept-model-status'];
      if (conceptChange) {
        setConceptModelStatus((conceptChange.newValue as typeof conceptModelStatus) ?? null);
      }
      const catalogChange = changes['personal-algorithm-durable-mode-catalog'];
      if (catalogChange) setDurableModeCatalog((catalogChange.newValue as DurableSemanticModeCatalog | undefined) ?? null);
      const modeConfigChange = changes['personal-algorithm-durable-mode-user-config'];
      if (modeConfigChange) {
        const config = modeConfigChange.newValue as { currentRevision?: number } | undefined;
        setModeConfigRevision(Number.isInteger(config?.currentRevision) ? Number(config?.currentRevision) : 0);
      }
      const historyClusterCatalogChange = changes['personal-algorithm-history-cluster-catalog'];
      if (historyClusterCatalogChange) {
        setHistoryClusterCatalog(
          (historyClusterCatalogChange.newValue as HistoryClusterCatalog | undefined) ?? null,
        );
      }
      const historyClusterOwnershipChange = changes['personal-algorithm-history-cluster-ownership'];
      if (historyClusterOwnershipChange) {
        setHistoryClusterOwnership(
          (historyClusterOwnershipChange.newValue as HistoryClusterOwnershipState | undefined) ?? null,
        );
      }
      const activeModeChange = changes['personal-algorithm-active-mode-id'];
      if (activeModeChange) setActiveModeId((activeModeChange.newValue as string | undefined) ?? 'default');
      const activeModeIdsChange = changes['personal-algorithm-active-mode-ids'];
      if (activeModeIdsChange) {
        setSelectedModeIds(Array.isArray(activeModeIdsChange.newValue)
          ? activeModeIdsChange.newValue as string[]
          : []);
      }
      const modeChange = changes['personal-algorithm-mode'];
      if (modeChange) setMode((modeChange.newValue as string | undefined) ?? 'Default');
    };
    chrome.storage.onChanged.addListener(handleStorageChanged);
    return () => chrome.storage.onChanged.removeListener(handleStorageChanged);
  }, []);

  const handleAcceptDisclosure = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'ACCEPT_PRIVACY_DISCLOSURE' }) as { ok?: boolean; error?: string };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to save privacy disclosure acceptance.');
      return;
    }
    setDisclosureAccepted(true);
    setStatus('Privacy disclosure accepted. MyAlgo is enabled.');
  };

  const handleDeleteLocalData = async () => {
    if (!window.confirm('Delete all locally stored MyAlgo evidence, graph state, settings, traces, and disclosure acceptance?')) return;
    const response = await chrome.runtime.sendMessage({ type: 'RESET_LOCAL_DATA' }) as { ok?: boolean; error?: string };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to delete local MyAlgo data.');
      return;
    }
    setDisclosureAccepted(false);
    setHistoryObservationEnabled(false);
    setHistoryClusterCatalog(null);
    setHistoryClusterOwnership(null);
    setHistoryClusterSearch('');
    setHomeObservationEnabled(false);
    setSemanticModelMode('hash');
    setTranscriptEnrichmentEnabled(false);
    setSemanticModelStatus(null);
    setConceptModelStatus(null);
    setNeuralBatchSize(1);
    setMode('Default');
    setActiveModeId('default');
    setSelectedModeIds([]);
    setModeNameDrafts({});
    setModeMemberDrafts({});
    setModeConfigRevision(0);
    setDurableModeCatalog(null);
    setGraphInspector(null);
    setGraphInspectorSource(null);
    setGraphModeId('all');
    setGraphFocusOnly(true);
    setGraphLayoutMode('network');
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setContentExplanation(null);
    setContentExplanationError(null);
    setOfflineGraphJson('');
    setStatus('Local MyAlgo data deleted. Accept the disclosure again before observation resumes.');
  };

  const handleModeChange = async (nextModeId: string) => {
    const response = await chrome.runtime.sendMessage({
      type: 'SET_MODE',
      payload: { modeId: nextModeId, toggle: nextModeId !== 'default' },
    }) as { ok?: boolean; error?: string; mode?: string; modeId?: string; modeIds?: string[] };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to change mode.');
      return;
    }
    setActiveModeId(response.modeId ?? 'default');
    setSelectedModeIds(response.modeIds ?? []);
    setMode(response.mode ?? 'Default');
    setStatus(null);
  };

  const handleRenameMode = async (
    modeId: string,
    inferredLabel: string | null,
    explicitLabel?: string | null,
  ) => {
    const label = (explicitLabel === undefined ? modeNameDrafts[modeId] ?? '' : explicitLabel ?? '').trim();
    const response = await chrome.runtime.sendMessage({
      type: 'DURABLE_MODE_CONFIG_UPDATE',
      payload: { modeId, label: label || null },
    }) as {
      ok?: boolean;
      error?: string;
      configRevision?: number;
      catalog?: DurableSemanticModeCatalog | null;
    };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to rename this group.');
      return;
    }
    if (response.catalog) setDurableModeCatalog(response.catalog);
    setModeConfigRevision(response.configRevision ?? modeConfigRevision);
    setModeNameDrafts((current) => {
      const next = { ...current };
      delete next[modeId];
      return next;
    });
    setStatus(label
      ? `Group renamed. Ownership config r${response.configRevision ?? modeConfigRevision}.`
      : `Group name reset to ${inferredLabel ?? 'its inferred label'}. Ownership config r${response.configRevision ?? modeConfigRevision}.`);
  };

  const handlePinMode = async (modeId: string, pinned: boolean) => {
    const response = await chrome.runtime.sendMessage({
      type: 'DURABLE_MODE_CONFIG_UPDATE',
      payload: { modeId, pinned },
    }) as {
      ok?: boolean;
      error?: string;
      configRevision?: number;
      catalog?: DurableSemanticModeCatalog | null;
    };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to update this group pin.');
      return;
    }
    if (response.catalog) setDurableModeCatalog(response.catalog);
    setModeConfigRevision(response.configRevision ?? modeConfigRevision);
    setStatus(`${pinned ? 'Pinned' : 'Unpinned'} group independently of feed selection. Ownership config r${response.configRevision ?? modeConfigRevision}.`);
  };

  const handleModeMembershipChange = async (
    modeId: string,
    memberAction: 'add' | 'remove' | 'reset',
    memberCanonicalId?: string,
  ) => {
    const response = await chrome.runtime.sendMessage({
      type: 'DURABLE_MODE_CONFIG_UPDATE',
      payload: {
        modeId,
        memberAction,
        ...(memberCanonicalId ? { memberCanonicalId } : {}),
      },
    }) as {
      ok?: boolean;
      error?: string;
      configRevision?: number;
      catalog?: DurableSemanticModeCatalog | null;
    };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to update group membership.');
      return;
    }
    if (response.catalog) setDurableModeCatalog(response.catalog);
    setModeConfigRevision(response.configRevision ?? modeConfigRevision);
    setModeMemberDrafts((current) => {
      const next = { ...current };
      delete next[modeId];
      return next;
    });
    setStatus(
      memberAction === 'add'
        ? `Member added. Ownership config r${response.configRevision ?? modeConfigRevision}.`
        : memberAction === 'remove'
          ? `Member removed from this group without deleting graph/evidence state. Ownership config r${response.configRevision ?? modeConfigRevision}.`
          : `Group membership reset to inferred members. Ownership config r${response.configRevision ?? modeConfigRevision}.`,
    );
  };

  const handleUndoModeConfig = async () => {
    const response = await chrome.runtime.sendMessage({
      type: 'DURABLE_MODE_CONFIG_UNDO',
    }) as {
      ok?: boolean;
      error?: string;
      reverted?: { action?: string; modeId?: string } | null;
      configRevision?: number;
      catalog?: DurableSemanticModeCatalog | null;
    };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to undo the last group edit.');
      return;
    }
    if (response.catalog) setDurableModeCatalog(response.catalog);
    setModeConfigRevision(response.configRevision ?? modeConfigRevision);
    setModeNameDrafts({});
    setModeMemberDrafts({});
    setStatus(response.reverted
      ? `Last group edit undone. Ownership config r${response.configRevision ?? modeConfigRevision}.`
      : 'There is no group ownership edit to undo.');
  };

  const handleHistoryObservationChange = async (enabled: boolean) => {
    setHistoryObservationEnabled(enabled);
    await chrome.storage.local.set({ 'personal-algorithm-history-observation-enabled': enabled });
  };

  const refreshHistoryClusterOwnership = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY_CLUSTER_OWNERSHIP' }) as {
      ok?: boolean;
      error?: string;
      catalog?: HistoryClusterCatalog;
      ownership?: HistoryClusterOwnershipState;
    };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to load history clusters.');
      return;
    }
    setHistoryClusterCatalog(response.catalog ?? null);
    setHistoryClusterOwnership(response.ownership ?? null);
  };

  const handleHistoryClusterSelection = async (clusterIds: string[] | null) => {
    const response = await chrome.runtime.sendMessage({
      type: 'SET_HISTORY_CLUSTER_SELECTION',
      payload: clusterIds == null ? {} : { clusterIds },
    }) as {
      ok?: boolean;
      error?: string;
      catalog?: HistoryClusterCatalog;
      ownership?: HistoryClusterOwnershipState;
    };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to update history cluster ownership.');
      return;
    }
    setHistoryClusterCatalog(response.catalog ?? null);
    setHistoryClusterOwnership(response.ownership ?? null);
    setStatus(
      response.ownership?.selectionMode === 'all'
        ? `All retained History influences MyAlgo. History ownership r${response.ownership.currentRevision}.`
        : `${response.ownership?.selectedClusterIds.length ?? 0} History cluster(s) influence MyAlgo. Retained excluded History was not deleted. History ownership r${response.ownership?.currentRevision ?? 0}.`,
    );
  };

  const handleToggleHistoryCluster = async (clusterId: string) => {
    const selected = new Set(historyClusterOwnership?.selectionMode === 'selected'
      ? historyClusterOwnership.selectedClusterIds
      : historyClusterCatalog?.clusters.map((cluster) => cluster.id) ?? []);
    if (selected.has(clusterId)) selected.delete(clusterId);
    else selected.add(clusterId);
    await handleHistoryClusterSelection([...selected]);
  };

  const handleUndoHistoryClusterSelection = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'UNDO_HISTORY_CLUSTER_SELECTION' }) as {
      ok?: boolean;
      error?: string;
      catalog?: HistoryClusterCatalog;
      ownership?: HistoryClusterOwnershipState;
      reverted?: { action?: string } | null;
    };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to undo History ownership.');
      return;
    }
    setHistoryClusterCatalog(response.catalog ?? null);
    setHistoryClusterOwnership(response.ownership ?? null);
    setStatus(response.reverted
      ? `History ownership edit undone. Revision ${response.ownership?.currentRevision ?? 0}.`
      : 'There is no History ownership edit to undo.');
  };

  const handleHomeObservationChange = async (enabled: boolean) => {
    setHomeObservationEnabled(enabled);
    await chrome.storage.local.set({ 'personal-algorithm-home-observation-enabled': enabled });
  };

  const handleTranscriptEnrichmentChange = async (enabled: boolean) => {
    const response = await chrome.runtime.sendMessage({
      type: 'SET_TRANSCRIPT_ENRICHMENT_ENABLED',
      payload: { enabled },
    }) as { ok?: boolean; enabled?: boolean; error?: string };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to change transcript enrichment.');
      return;
    }
    setTranscriptEnrichmentEnabled(response.enabled === true);
    setStatus(response.enabled
      ? 'YouTube caption enrichment enabled. Available English captions will be sampled locally on upcoming metadata refreshes.'
      : 'YouTube caption enrichment disabled. Existing local caption cache remains until Delete all local MyAlgo data.');
  };

  const handleSemanticModelChange = async (enabled: boolean) => {
    const nextMode = enabled ? 'neural' : 'hash';
    setSemanticModelStatus(null);
    setConceptModelStatus(null);
    setStatus(enabled
      ? 'Local neural semantics enabled. The packaged embedding model and concept verifier will run on upcoming semantic passes.'
      : 'Using the lightweight deterministic semantic baseline.');
    const response = await chrome.runtime.sendMessage({
      type: 'SET_SEMANTIC_MODEL_MODE',
      payload: { semanticModelMode: nextMode },
    }) as { ok?: boolean; error?: string; semanticModelMode?: 'hash' | 'neural' };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to change semantic model.');
      return;
    }
    setSemanticModelMode(response.semanticModelMode === 'neural' ? 'neural' : 'hash');
  };

  const handleLoadLiveGraph = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'PERSONAL_ALGORITHM_INSPECT' }) as {
      ok?: boolean;
      state?: unknown;
      durableModeCatalog?: DurableSemanticModeCatalog | null;
      activeModeId?: string;
      semanticContext?: GraphInspectorSemanticContext[];
      error?: string;
    };
    if (!response?.ok || !response.state) {
      setStatus(response?.error ?? 'Unable to inspect the local Personal Algorithm Graph.');
      return;
    }
    try {
      const durableCatalog = response.durableModeCatalog ?? null;
      const view = buildGraphInspectorView(response.state, response.semanticContext ?? [], durableCatalog);
      setGraphInspector(view);
      setGraphInspectorSource('live');
      setDurableModeCatalog(durableCatalog);
      setActiveModeId(response.activeModeId ?? 'default');
      setGraphModeId('all');
      setGraphFocusOnly(true);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setContentExplanation(null);
      setContentExplanationError(null);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to inspect the local Personal Algorithm Graph.');
    }
  };

  const handleGraphControl = async (
    targetKind: 'node' | 'edge',
    targetId: string,
    action: 'reduce' | 'prefer' | 'mute',
  ) => {
    const response = await chrome.runtime.sendMessage({
      type: 'PERSONAL_ALGORITHM_SET_CONTROL',
      payload: { targetKind, targetId, action },
    }) as { ok?: boolean; error?: string };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to update graph control.');
      return;
    }
    await handleLoadLiveGraph();
    if (targetKind === 'node') setSelectedNodeId(targetId);
    else setSelectedEdgeId(targetId);
    setStatus(`${action === 'prefer' ? 'Prefer' : action === 'reduce' ? 'Reduce' : 'Mute'} saved as a revisioned graph control.`);
  };

  const handleRemoveGraphControl = async (
    targetKind: 'node' | 'edge',
    targetId: string,
  ) => {
    const response = await chrome.runtime.sendMessage({
      type: 'PERSONAL_ALGORITHM_REMOVE_CONTROL',
      payload: { targetKind, targetId },
    }) as { ok?: boolean; error?: string; removed?: boolean };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to remove graph control.');
      return;
    }
    await handleLoadLiveGraph();
    if (targetKind === 'node') setSelectedNodeId(targetId);
    else setSelectedEdgeId(targetId);
    setStatus(response.removed ? 'Graph control cleared.' : 'No graph control was set for this target.');
  };

  const handleUndoGraphEdit = async () => {
    const response = await chrome.runtime.sendMessage({
      type: 'PERSONAL_ALGORITHM_UNDO_CONTROL',
    }) as { ok?: boolean; error?: string; edit?: unknown };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to undo the last graph edit.');
      return;
    }
    await handleLoadLiveGraph();
    setStatus(response.edit ? 'Last graph edit undone.' : 'There is no graph edit to undo.');
  };

  const handleRestoreOriginalGraph = async () => {
    const response = await chrome.runtime.sendMessage({
      type: 'PERSONAL_ALGORITHM_RESTORE_ORIGINAL',
    }) as { ok?: boolean; error?: string; restored?: boolean };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to restore the original graph.');
      return;
    }
    await handleLoadLiveGraph();
    setStatus(response.restored
      ? 'Original pre-edit graph restored. Retained evidence was not deleted.'
      : 'No pre-edit graph baseline has been captured yet.');
  };

  const handleForgetEvidence = async (evidenceId: string, edgeId: string) => {
    if (!window.confirm('Forget this retained evidence? This deletes the evidence and excludes the same record from future reconstruction. Graph-edit Undo will not restore it.')) return;
    const response = await chrome.runtime.sendMessage({
      type: 'PERSONAL_ALGORITHM_FORGET_EVIDENCE',
      payload: { evidenceId },
    }) as { ok?: boolean; error?: string; forgotten?: boolean; graphRevision?: number };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to forget this evidence.');
      return;
    }
    await handleLoadLiveGraph();
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
    setStatus(response.forgotten
      ? `Evidence forgotten. Graph/evidence state is now revision ${response.graphRevision ?? 'updated'}; graph-edit Undo cannot restore the deleted evidence.`
      : 'That evidence is no longer retained.');
  };


  const handleInspectOfflineGraph = () => {
    try {
      const view = parseGraphInspectorExport(offlineGraphJson);
      setGraphInspector(view);
      setGraphInspectorSource('offline');
      setGraphModeId('all');
      setGraphFocusOnly(true);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to inspect the pasted graph export.');
    }
  };

  const handleExplainSelectedContent = async () => {
    if (!selectedGraphNode?.contentExternalId) return;
    setContentExplanationLoading(true);
    setContentExplanationError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'PERSONAL_ALGORITHM_EXPLAIN_CONTENT',
        payload: { externalId: selectedGraphNode.contentExternalId },
      }) as { ok?: boolean; item?: ContentExplanation; error?: string };
      if (!response?.ok || !response.item) {
        setContentExplanation(null);
        setContentExplanationError(response?.error ?? 'Unable to explain this content.');
        return;
      }
      setContentExplanation(response.item);
    } catch (error) {
      setContentExplanation(null);
      setContentExplanationError(error instanceof Error ? error.message : 'Unable to explain this content.');
    } finally {
      setContentExplanationLoading(false);
    }
  };

  const handleNeuralBatchSizeChange = async (nextBatchSize: number) => {
    const batchSize = Math.max(1, Math.min(16, Math.floor(nextBatchSize)));
    setNeuralBatchSize(batchSize);
    const response = await chrome.runtime.sendMessage({
      type: 'SET_SEMANTIC_NEURAL_BATCH_SIZE',
      payload: { batchSize },
    }) as { ok?: boolean; error?: string; batchSize?: number };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to change neural batch size.');
      return;
    }
    setNeuralBatchSize(Number(response.batchSize ?? batchSize));
    setStatus(`Neural WebGPU batch size set to ${response.batchSize ?? batchSize}. New embedding work will use this setting.`);
  };

  const modeOptions = buildDurableModeOptions(activeModeId, durableModeCatalog, mode);
  const selectedModeOptions = modeOptions.filter((option) => (
    option.id !== 'default' && selectedModeIds.includes(option.id)
  ));
  const interestCards = modeOptions
    .filter((option) => option.id !== 'default')
    .map((option) => {
      const configuredMode = durableModeCatalog?.modes.find((entry) => entry.id === option.id) ?? null;
      const supportContentIds = new Set(
        configuredMode?.members.flatMap((member) => member.supportContentIds) ?? [],
      );
      return {
        ...option,
        selected: selectedModeIds.includes(option.id),
        memberCount: configuredMode?.members.length ?? 0,
        supportCount: supportContentIds.size,
        memberLabels: (configuredMode?.members ?? []).slice(0, 4).map((member) => member.label),
      };
    })
    .sort((left, right) => (
      Number(right.selected) - Number(left.selected)
      || Number(right.pinned) - Number(left.pinned)
      || Number(right.active) - Number(left.active)
      || right.supportCount - left.supportCount
      || left.label.localeCompare(right.label)
    ));
  const normalizedModeSearch = modeSearch.trim().toLowerCase();
  const searchableModeOptions = modeOptions.filter((option) => (
    option.id !== 'default'
    && (!normalizedModeSearch
      || option.label.toLowerCase().includes(normalizedModeSearch)
      || option.id.toLowerCase().includes(normalizedModeSearch))
  ));
  const normalizedHistoryClusterSearch = historyClusterSearch.trim().toLowerCase();
  const selectedHistoryClusterIds = new Set(
    historyClusterOwnership?.selectionMode === 'selected'
      ? historyClusterOwnership.selectedClusterIds
      : historyClusterCatalog?.clusters.map((cluster) => cluster.id) ?? [],
  );
  const visibleHistoryClusters = [...(historyClusterCatalog?.clusters ?? [])]
    .filter((cluster) => (
      !normalizedHistoryClusterSearch
      || cluster.label.toLowerCase().includes(normalizedHistoryClusterSearch)
      || cluster.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedHistoryClusterSearch))
      || cluster.creatorLabels.some((creator) => creator.toLowerCase().includes(normalizedHistoryClusterSearch))
    ))
    .sort((left, right) => (
      Number(selectedHistoryClusterIds.has(right.id)) - Number(selectedHistoryClusterIds.has(left.id))
      || right.size - left.size
      || left.label.localeCompare(right.label)
    ));

  const effectiveGraphInspector = graphInspector && graphInspectorSource === 'live'
    ? applyDurableModeLabelsToGraphInspector(graphInspector, durableModeCatalog)
    : graphInspector;
  const graphGroupCoverage = effectiveGraphInspector
    ? summarizeGraphGroupCoverage(effectiveGraphInspector)
    : null;
  const normalizedGraphQuery = graphQuery.trim().toLowerCase();
  const filteredGraphNodes = (effectiveGraphInspector?.nodes ?? []).filter((node) => (
    !normalizedGraphQuery
    || node.label.toLowerCase().includes(normalizedGraphQuery)
    || node.id.toLowerCase().includes(normalizedGraphQuery)
    || node.kind.toLowerCase().includes(normalizedGraphQuery)
  )).slice(0, 80);
  const filteredGraphEdges = (effectiveGraphInspector?.edges ?? []).filter((edge) => (
    !normalizedGraphQuery
    || edge.relation.toLowerCase().includes(normalizedGraphQuery)
    || edge.sourceLabel.toLowerCase().includes(normalizedGraphQuery)
    || edge.targetLabel.toLowerCase().includes(normalizedGraphQuery)
    || edge.id.toLowerCase().includes(normalizedGraphQuery)
  )).slice(0, 80);
  const graphModeCatalog = graphInspectorSource === 'live' ? durableModeCatalog : null;
  const graphModeOverlay = effectiveGraphInspector
    ? buildGraphModeOverlay(effectiveGraphInspector, graphModeCatalog, graphModeId)
    : buildGraphModeOverlay({
        schemaVersion: 2,
        graphRevision: 0,
        evidenceCount: 0,
        forgottenEvidenceCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        nodesByKind: [],
        edgesByRelation: [],
        nodes: [],
        edges: [],
        controls: [],
        revisions: [],
      }, durableModeCatalog, 'all');
  const selectedGraphNode = effectiveGraphInspector?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedGraphEdge = effectiveGraphInspector?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const selectedGraphNodeEdges = selectedGraphNode
    ? (effectiveGraphInspector?.edges ?? []).filter((edge) => (
        edge.sourceNodeId === selectedGraphNode.id || edge.targetNodeId === selectedGraphNode.id
      )).slice(0, 16)
    : [];
  const explanationGraphView = effectiveGraphInspector && selectedGraphNode && contentExplanation
    ? buildExplanationGraphView(
        effectiveGraphInspector,
        selectedGraphNode.id,
        contentExplanation.explanation,
      )
    : null;
  const explanationGraphOverlay = explanationGraphView
    ? buildGraphModeOverlay(explanationGraphView, null, 'all')
    : null;
  const mutedGraphControls = (graphInspector?.controls ?? [])
    .filter((control) => control.action === 'mute')
    .sort((left, right) => left.targetLabel.localeCompare(right.targetLabel));

  const discoveredModeMemberPool = [...new Map(
    (durableModeCatalog?.modes ?? [])
      .flatMap((entry) => entry.inferredMembers ?? entry.members)
      .map((member) => [member.canonicalId, member] as const),
  ).values()]
    .sort((left, right) => left.label.localeCompare(right.label) || left.canonicalId.localeCompare(right.canonicalId));

  const graphSearchResults = normalizedGraphQuery
    ? [
        ...filteredGraphNodes.slice(0, 8).map((node) => ({ id: node.id, label: node.label, kind: node.kind, type: 'node' as const })),
        ...filteredGraphEdges.slice(0, 5).map((edge) => ({
          id: edge.id,
          label: `${edge.sourceLabel} → ${edge.targetLabel}`,
          kind: edge.relation,
          type: 'edge' as const,
        })),
      ]
    : [];

  return (
    <main style={{ maxWidth: 1240, margin: '0 auto', padding: 24, fontFamily: 'sans-serif', color: '#0f172a' }}>
      <h1>Personal Algorithm settings</h1>

      <section style={{ marginBottom: 24, padding: 16, border: '1px solid #cbd5e1', borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Privacy disclosure</h2>
        <p><strong>Version {PRIVACY_DISCLOSURE_VERSION}</strong> · {disclosureAccepted ? 'Accepted' : 'Acceptance required before observation'}</p>
        <p>MyAlgo observes {PRIVACY_DISCLOSURE.pages.toLowerCase()} and records {PRIVACY_DISCLOSURE.data}.</p>
        <p>Purpose: {PRIVACY_DISCLOSURE.purpose}.</p>
        <p>Storage: {PRIVACY_DISCLOSURE.storage}. Transfer: {PRIVACY_DISCLOSURE.transfer}.</p>
        <p>Control: {PRIVACY_DISCLOSURE.deletion}.</p>
        {!disclosureAccepted ? (
          <button type="button" onClick={() => void handleAcceptDisclosure()}>Accept and enable MyAlgo</button>
        ) : null}
        <p><a href="https://github.com/AsimovNo9/MyAlgo/blob/main/PRIVACY.md" target="_blank" rel="noreferrer">Read the privacy policy</a></p>
        {status ? <p role="status">{status}</p> : null}
      </section>

      <section style={{ marginBottom: 24, padding: 16, border: '1px solid #cbd5e1', borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Your interests</h2>
        <p>
          These are the recurring interests MyAlgo currently recognizes. You can choose what you want to use for your feed
          without editing the graph underneath.
        </p>
        {interestCards.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12 }}>
            {interestCards.map((interest) => (
              <article
                key={`interest:${interest.id}`}
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: interest.selected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                  background: interest.selected ? '#eff6ff' : '#fff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div>
                    <strong style={{ fontSize: 16 }}>{interest.label}</strong>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
                      {interest.memberCount} signal{interest.memberCount === 1 ? '' : 's'}
                      {' · '}{interest.supportCount} supporting video{interest.supportCount === 1 ? '' : 's'}
                      {!interest.active ? ' · retained' : ''}
                    </div>
                  </div>
                  <span style={{
                    borderRadius: 999,
                    padding: '3px 7px',
                    fontSize: 11,
                    background: interest.selected ? '#dbeafe' : '#f1f5f9',
                    color: interest.selected ? '#1d4ed8' : '#475569',
                  }}>
                    {interest.selected ? 'Used for feed' : 'Available'}
                  </span>
                </div>
                {interest.memberLabels.length > 0 ? (
                  <p style={{ margin: '10px 0', fontSize: 13, color: '#475569' }}>
                    {interest.memberLabels.join(' · ')}
                  </p>
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => void handleModeChange(interest.id)}>
                    {interest.selected ? 'Stop using for feed' : 'Use for feed'}
                  </button>
                  <button type="button" onClick={() => void handlePinMode(interest.id, !interest.pinned)}>
                    {interest.pinned ? 'Allow to fade' : 'Keep this interest'}
                  </button>
                </div>
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: 'pointer' }}>Why MyAlgo sees this</summary>
                  <p style={{ fontSize: 12, color: '#64748b', marginBottom: 0 }}>
                    This interest is built from repeated local semantic signals and their supporting retained videos.
                    Open Advanced group management below to rename it or edit its exact members.
                  </p>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <p style={{ color: '#64748b' }}>
            No durable interests yet. As repeated evidence accumulates, MyAlgo will surface stable interests here.
          </p>
        )}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Advanced group management</h2>
        <p>
          Use this section when you want exact control over group selection, names, retained ownership, or membership.
          The simpler Your interests cards above are enough for normal feed tuning.
        </p>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Selected</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            aria-pressed={selectedModeIds.length === 0}
            onClick={() => void handleModeChange('default')}
            style={{
              borderRadius: 999,
              padding: '7px 11px',
              border: selectedModeIds.length === 0 ? '2px solid #2563eb' : '1px solid #94a3b8',
              background: selectedModeIds.length === 0 ? '#dbeafe' : '#fff',
              fontWeight: selectedModeIds.length === 0 ? 700 : 500,
            }}
          >
            All
          </button>
          {selectedModeOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed="true"
              title="Click to deselect"
              onClick={() => void handleModeChange(option.id)}
              style={{
                borderRadius: 999,
                padding: '7px 11px',
                border: '2px solid #2563eb',
                background: '#dbeafe',
                fontWeight: 700,
              }}
            >
              {option.label}{option.active ? '' : ' · retained'}
            </button>
          ))}
        </div>

        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
            Browse discovered groups ({Math.max(0, modeOptions.length - 1)})
          </summary>
          <label htmlFor="mode-search" style={{ display: 'block', marginTop: 12, fontWeight: 600 }}>
            Search groups
          </label>
          <input
            id="mode-search"
            type="search"
            value={modeSearch}
            onChange={(event) => setModeSearch(event.target.value)}
            placeholder="Search by group name"
            style={{ width: '100%', maxWidth: 420, padding: 8, margin: '6px 0 12px' }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
            {searchableModeOptions.map((option) => {
              const pressed = selectedModeIds.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => void handleModeChange(option.id)}
                  style={{
                    borderRadius: 999,
                    padding: '7px 11px',
                    border: pressed ? '2px solid #2563eb' : '1px solid #94a3b8',
                    background: pressed ? '#dbeafe' : '#fff',
                    fontWeight: pressed ? 700 : 500,
                  }}
                >
                  {option.label}{option.active ? '' : ' (retained)'}
                </button>
              );
            })}
            {searchableModeOptions.length === 0 ? <span>No matching groups.</span> : null}
          </div>
        </details>
        <details style={{ marginTop: 14 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
            Manage group ownership · config r{modeConfigRevision}
          </summary>
          <p>
            Rename, pin, and member edits are durable user-owned overlays. Pinning is independent of whether a group is currently selected for the feed.
            Undo reverses the latest ownership edit without changing retained evidence or the reconciler-owned inferred label/membership.
          </p>
          <button type="button" onClick={() => void handleUndoModeConfig()}>
            Undo last group edit
          </button>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {searchableModeOptions.map((option) => (
              <div
                key={`manage:${option.id}`}
                style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 10 }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <div>
                    <strong>{option.label}</strong>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {option.active ? 'active' : 'dormant'} · semantic r{option.revision ?? '?'} · {option.pinned ? 'pinned' : 'not pinned'}
                    </div>
                    {option.inferredLabel && option.inferredLabel !== option.label ? (
                      <div style={{ fontSize: 12, color: '#64748b' }}>Inferred name: {option.inferredLabel}</div>
                    ) : null}
                  </div>
                  <button type="button" onClick={() => void handlePinMode(option.id, !option.pinned)}>
                    {option.pinned ? 'Unpin' : 'Pin'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    aria-label={`Rename ${option.label}`}
                    value={modeNameDrafts[option.id] ?? ''}
                    placeholder={option.label}
                    maxLength={80}
                    onChange={(event) => setModeNameDrafts((current) => ({
                      ...current,
                      [option.id]: event.target.value,
                    }))}
                    style={{ flex: '1 1 240px', minWidth: 180, padding: 7 }}
                  />
                  <button type="button" onClick={() => void handleRenameMode(option.id, option.inferredLabel)}>
                    Save name
                  </button>
                  {option.inferredLabel && option.label !== option.inferredLabel ? (
                    <button
                      type="button"
                      onClick={() => {
                        setModeNameDrafts((current) => ({ ...current, [option.id]: '' }));
                        void handleRenameMode(option.id, option.inferredLabel, null);
                      }}
                    >
                      Reset name
                    </button>
                  ) : null}
                </div>
                {(() => {
                  const configuredMode = durableModeCatalog?.modes.find((entry) => entry.id === option.id);
                  if (!configuredMode) return null;
                  const inferredMembers = configuredMode.inferredMembers ?? configuredMode.members;
                  const inferredIds = new Set(inferredMembers.map((member) => member.canonicalId));
                  const effectiveIds = new Set(configuredMode.members.map((member) => member.canonicalId));
                  const membershipEdited = (
                    configuredMode.members.length !== inferredMembers.length
                    || configuredMode.members.some((member) => !inferredIds.has(member.canonicalId))
                    || inferredMembers.some((member) => !effectiveIds.has(member.canonicalId))
                  );
                  const availableMembers = discoveredModeMemberPool.filter((member) => !effectiveIds.has(member.canonicalId));
                  return (
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                        Members ({configuredMode.members.length}{membershipEdited ? ' · edited' : ''})
                      </summary>
                      <p style={{ fontSize: 12, color: '#64748b' }}>
                        Membership edits change this group lens only. They do not delete evidence, graph nodes, or the reconciler-owned inferred membership.
                      </p>
                      <div style={{ display: 'grid', gap: 6 }}>
                        {configuredMode.members.map((member) => (
                          <div
                            key={member.canonicalId}
                            style={{
                              display: 'flex',
                              gap: 8,
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 8px',
                              border: '1px solid #e2e8f0',
                              borderRadius: 8,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <strong>{member.label}</strong>
                              <div style={{ fontSize: 11, color: '#64748b', overflowWrap: 'anywhere' }}>
                                {member.canonicalId}{inferredIds.has(member.canonicalId) ? ' · inferred' : ' · user-added'}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleModeMembershipChange(option.id, 'remove', member.canonicalId)}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        {configuredMode.members.length === 0 ? (
                          <span style={{ fontSize: 12, color: '#64748b' }}>No effective members. Add one below or reset inferred membership.</span>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <select
                          aria-label={`Add member to ${option.label}`}
                          value={modeMemberDrafts[option.id] ?? ''}
                          onChange={(event) => setModeMemberDrafts((current) => ({
                            ...current,
                            [option.id]: event.target.value,
                          }))}
                          style={{ flex: '1 1 260px', minWidth: 220, padding: 7 }}
                        >
                          <option value="">Choose discovered member…</option>
                          {availableMembers.map((member) => (
                            <option key={member.canonicalId} value={member.canonicalId}>
                              {member.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!modeMemberDrafts[option.id]}
                          onClick={() => {
                            const memberId = modeMemberDrafts[option.id];
                            if (memberId) void handleModeMembershipChange(option.id, 'add', memberId);
                          }}
                        >
                          Add member
                        </button>
                        {membershipEdited ? (
                          <button type="button" onClick={() => void handleModeMembershipChange(option.id, 'reset')}>
                            Reset members
                          </button>
                        ) : null}
                      </div>
                    </details>
                  );
                })()}
              </div>
            ))}
          </div>
        </details>
        <p>
          Groups are discovered from retained semantic graph support. Repeated standalone interests can become groups once supported
          by at least two retained videos; parent/child reclustering does not silently clear a user selection.
        </p>
      </section>

      <section style={{ marginBottom: 24, padding: 16, border: '1px solid #cbd5e1', borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Muted graph terms</h2>
        <p>
          Mute is a hard Personal Algorithm suppression. Muted terms remain visible here until you explicitly unmute them;
          unmuting removes only the mute control and does not delete retained history or graph evidence.
        </p>
        {graphInspectorSource !== 'live' ? (
          <button type="button" onClick={() => void handleLoadLiveGraph()}>
            Load muted terms
          </button>
        ) : mutedGraphControls.length === 0 ? (
          <p>No graph terms are currently muted.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {mutedGraphControls.map((control) => (
              <div
                key={control.id}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 10,
                  border: '1px solid #cbd5e1',
                  borderRadius: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <strong>{control.targetLabel}</strong>
                  <div style={{ fontSize: 12, color: '#64748b', overflowWrap: 'anywhere' }}>
                    {control.targetKind} · {control.targetId}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemoveGraphControl(control.targetKind, control.targetId)}
                >
                  Unmute
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Local-first MVP</h2>
        <p>Observation, feed controls, and recorded interactions stay in this browser until optional sync is introduced.</p>
      </section>

      <section style={{ marginTop: 24, padding: 16, border: '1px solid #cbd5e1', borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>Local semantic model</h2>
        <label>
          <input
            type="checkbox"
            checked={semanticModelMode === 'neural'}
            disabled={!disclosureAccepted}
            onChange={(event) => void handleSemanticModelChange(event.target.checked)}
          />
          Use local neural semantics
        </label>
        <p>
          When enabled, MyAlgo uses two models packaged with this extension build: mixedbread-ai/mxbai-embed-xsmall-v1
          for candidate↔graph semantic retrieval and DeBERTa-v3-xsmall NLI for bounded zero-shot verification of metadata concepts
          plus ambiguous graph matches. Clear high-confidence embedding matches skip DeBERTa. Candidate text, verified concepts,
          graph state, embeddings, and inference stay local. The installed extension does not download
          model files at runtime. Embeddings prefer WebGPU and fall back to local WebAssembly CPU inference when needed.
          The concept verifier deliberately uses q8 WebAssembly CPU inference, which is independent of the embedding batch slider.
          Metadata concept verification remains asynchronous. For ambiguous graph matches, verifier failure preserves the embedding
          result with explicit fallback provenance instead of failing ranking.
        </p>
        <p><strong>Current semantic provider:</strong> {semanticModelMode === 'neural' ? 'Neural local (WebGPU embeddings + bounded WASM NLI verification)' : 'Deterministic baseline'}</p>
        <div style={{ marginTop: 16, padding: 12, border: '1px solid #cbd5e1', borderRadius: 10 }}>
          <label>
            <input
              type="checkbox"
              checked={transcriptEnrichmentEnabled}
              disabled={!disclosureAccepted || semanticModelMode !== 'neural'}
              onChange={(event) => void handleTranscriptEnrichmentChange(event.target.checked)}
            />
            Use YouTube captions for local semantic enrichment
          </label>
          <p style={{ marginBottom: 0 }}>
            Experimental and off by default. When a video exposes an English caption track, MyAlgo requests it from a
            YouTube-owned caption endpoint, keeps a bounded beginning/middle/end excerpt locally, and uses that excerpt only
            as additional input to the packaged mxbai/DeBERTa semantic pipeline. Captions do not become exact preference
            evidence and are not added to deterministic lexical scoring. Disabling stops new caption acquisition; Delete all
            local MyAlgo data clears the retained caption cache. This slice does not ship Whisper or another speech-to-text model.
          </p>
        </div>
        <div style={{ marginTop: 16 }}>
          <label htmlFor="semantic-neural-batch-size">
            WebGPU embedding batch size: <strong>{neuralBatchSize}</strong>
          </label>
          <input
            id="semantic-neural-batch-size"
            type="range"
            min="1"
            max="16"
            step="1"
            value={neuralBatchSize}
            disabled={!disclosureAccepted || semanticModelMode !== 'neural'}
            onChange={(event) => void handleNeuralBatchSizeChange(Number(event.target.value))}
            style={{ display: 'block', width: '100%', marginTop: 8 }}
          />
          <p style={{ marginTop: 6 }}>
            Higher values process more embedding texts per WebGPU inference call and can drain embedding work faster,
            but use more GPU memory. Start at 2–4 on older GPUs and increase only while inference remains stable.
            This slider does not change concept verification. The DeBERTa verifier runs on its own bounded q8 WASM CPU path.
          </p>
        </div>

        {semanticModelStatus ? (
          <p role="status">
            <strong>Embedding model:</strong> {semanticModelStatus.status ?? 'unknown'}
            {typeof semanticModelStatus.progress === 'number' ? ` · ${semanticModelStatus.progress.toFixed(1)}%` : ''}
            {semanticModelStatus.backend ? ` · ${semanticModelStatus.backend}` : ''}
            {semanticModelStatus.file ? ` · ${semanticModelStatus.file}` : ''}
          </p>
        ) : null}
        {conceptModelStatus ? (
          <p role="status">
            <strong>Concept model:</strong> {conceptModelStatus.status ?? 'unknown'}
            {typeof conceptModelStatus.progress === 'number' ? ` · ${conceptModelStatus.progress.toFixed(1)}%` : ''}
            {conceptModelStatus.backend ? ` · ${conceptModelStatus.backend}` : ''}
            {conceptModelStatus.file ? ` · ${conceptModelStatus.file}` : ''}
            {typeof conceptModelStatus.item === 'number' && typeof conceptModelStatus.itemCount === 'number'
              ? ` · item ${conceptModelStatus.item}/${conceptModelStatus.itemCount}`
              : ''}
            {conceptModelStatus.error ? ` · ${conceptModelStatus.error}` : ''}
          </p>
        ) : null}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Experimental history bootstrap</h2>
        <label>
          <input
            type="checkbox"
            checked={historyObservationEnabled}
            onChange={(event) => void handleHistoryObservationChange(event.target.checked)}
          />
          Read visible YouTube History items to build local evidence
        </label>
        <p>When enabled, MyAlgo stores visible video IDs, titles, creators, displayed history timestamps, and page provenance only in this browser. You can disable this at any time; no history is sent to a server.</p>
        {historyObservationEnabled && (
          <button
            type="button"
            onClick={() => window.open('https://www.youtube.com/feed/history', '_blank', 'noopener,noreferrer')}
            style={{ marginTop: 12, padding: '8px 12px' }}
          >
            Open YouTube History
          </button>
        )}
      </section>

      <section style={{ marginTop: 24, padding: 16, border: '1px solid #cbd5e1', borderRadius: 12 }}>
        <h2 style={{ marginTop: 0 }}>What should your History teach MyAlgo?</h2>
        <p>
          MyAlgo found these areas in your retained YouTube History. Choose the ones that should shape recommendations.
          Turning one off does not delete that History; it only stops that cluster from teaching MyAlgo.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            aria-pressed={historyClusterOwnership?.selectionMode !== 'selected'}
            onClick={() => void handleHistoryClusterSelection(null)}
          >
            Use all retained History
          </button>
          <button type="button" onClick={() => void handleUndoHistoryClusterSelection()}>
            Undo last History choice
          </button>
          <button type="button" onClick={() => void refreshHistoryClusterOwnership()}>
            Refresh clusters
          </button>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            revision {historyClusterOwnership?.currentRevision ?? 0}
          </span>
        </div>
        <label htmlFor="history-cluster-search" style={{ display: 'block', marginTop: 12, fontWeight: 600 }}>
          Find an area of History
        </label>
        <input
          id="history-cluster-search"
          type="search"
          value={historyClusterSearch}
          onChange={(event) => setHistoryClusterSearch(event.target.value)}
          placeholder="Search topics, creators, or activities"
          style={{ width: '100%', maxWidth: 420, padding: 8, margin: '6px 0 12px' }}
        />
        {historyClusterCatalog?.clusters.length ? (
          <div style={{ display: 'grid', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
            {visibleHistoryClusters.map((cluster) => {
              const selected = selectedHistoryClusterIds.has(cluster.id);
              return (
                <button
                  key={cluster.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => void handleToggleHistoryCluster(cluster.id)}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: selected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                    background: selected ? '#dbeafe' : '#fff',
                    textAlign: 'left',
                  }}
                >
                  <strong>{cluster.label}</strong>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>
                    {selected ? 'Used for recommendations' : 'Not used for recommendations'}
                    {' · '}{cluster.size} retained video{cluster.size === 1 ? '' : 's'}
                    {cluster.creatorLabels.length > 0 ? ` · ${cluster.creatorLabels.join(', ')}` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', overflowWrap: 'anywhere', marginTop: 2 }}>
                    {cluster.id}
                  </div>
                </button>
              );
            })}
            {visibleHistoryClusters.length === 0 ? <span>No matching History clusters.</span> : null}
          </div>
        ) : (
          <p style={{ color: '#64748b' }}>
            No History clusters yet. Enable History observation and visit YouTube History, then refresh clusters.
          </p>
        )}
        {historyClusterOwnership?.selectionMode === 'selected' ? (
          <p style={{ marginBottom: 0 }}>
            <strong>{historyClusterOwnership.selectedClusterIds.length}</strong> cluster(s) currently influence MyAlgo.
            Unselected retained History remains stored locally and can be re-included or forgotten separately.
          </p>
        ) : (
          <p style={{ marginBottom: 0 }}>All retained History currently influences MyAlgo.</p>
        )}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Experimental Home context</h2>
        <label>
          <input
            type="checkbox"
            checked={homeObservationEnabled}
            onChange={(event) => void handleHomeObservationChange(event.target.checked)}
          />
          Record visible YouTube Home recommendations as context
        </label>
        <p>When enabled, MyAlgo stores visible video IDs, titles, creators, position, section, and observation time only in this browser. A surfaced recommendation is not treated as a preference; clicks and later history matches are recorded separately.</p>
      </section>

      <section style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #cbd5e1' }}>
        <h2>Advanced graph & evidence</h2>
        <p>
          You do not need this view to tune MyAlgo. It is the transparent inspection layer for people who want to see exactly
          how interests, evidence, creators, concepts, and recommendations connect. Explore the current local graph visually,
          search stable graph IDs, switch between durable group overlays,
          and inspect exact retained evidence. Live snapshots place content into its strongest durable group when one exists;
          otherwise they may show a provisional semantic topic cluster. Topic clusters are visual derived context only and do
          not appear in the Groups selector or durable-group dropdown until repeated retained support promotes them into a
          durable group. Selecting a live node or relationship also exposes revisioned Reduce / Prefer / Mute controls.
          Offline pasted snapshots remain read-only.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <button type="button" onClick={() => void handleLoadLiveGraph()}>Load live graph</button>
          {graphInspectorSource === 'live' ? (
            <>
              <button type="button" onClick={() => void handleUndoGraphEdit()}>Undo last edit</button>
              <button type="button" onClick={() => void handleRestoreOriginalGraph()}>Restore original</button>
            </>
          ) : null}
          {graphInspector ? (
            <span>
              {graphInspectorSource === 'live' ? 'Live snapshot' : 'Offline pasted snapshot'}
              {' · '}graph r{graphInspector.graphRevision}
              {' · '}{graphInspector.nodeCount} nodes
              {' · '}{graphInspector.edgeCount} edges
              {' · '}{graphInspector.evidenceCount} retained evidence
              {graphInspector.forgottenEvidenceCount > 0 ? ` · ${graphInspector.forgottenEvidenceCount} forgotten` : ''}
            </span>
          ) : null}
        </div>

        <details style={{ marginBottom: 16 }}>
          <summary>Inspect an exported graph snapshot offline</summary>
          <p style={{ marginBottom: 8 }}>
            Paste a MyAlgo export. Parsing stays in this Settings page and never writes the pasted snapshot into live graph state.
          </p>
          <textarea
            value={offlineGraphJson}
            onChange={(event) => setOfflineGraphJson(event.target.value)}
            rows={7}
            placeholder="Paste myalgo-personal-algorithm-state.json here"
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }}
          />
          <button
            type="button"
            disabled={!offlineGraphJson.trim()}
            onClick={handleInspectOfflineGraph}
            style={{ marginTop: 8 }}
          >
            Inspect pasted snapshot
          </button>
        </details>

        {graphInspector ? (
          <div style={{
            border: '1px solid #1e293b',
            borderRadius: 16,
            background: '#0b0f16',
            color: '#e2e8f0',
            padding: 16,
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)',
              gap: 14,
              alignItems: 'start',
            }}>
              <aside style={{
                padding: 12,
                border: '1px solid #263244',
                borderRadius: 12,
                background: '#111827',
              }}>
                <label htmlFor="graph-layout-mode">
                  <strong>Layout</strong>
                  <select
                    id="graph-layout-mode"
                    value={graphLayoutMode}
                    onChange={(event) => setGraphLayoutMode(event.target.value === 'lineage' ? 'lineage' : 'network')}
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: 8 }}
                  >
                    <option value="network">Network</option>
                    <option value="lineage">Lineage / family tree</option>
                  </select>
                </label>

                <p style={{ margin: '6px 0 14px', color: '#94a3b8', fontSize: 11 }}>
                  Lineage layers content/history toward the leaves, then creators/topics/concepts, then objectives/user-level nodes.
                  It uses only stored graph edges; it does not invent ancestry.
                </p>

                <label htmlFor="graph-mode-overlay">
                  <strong>Durable group overlay</strong>
                  <select
                    id="graph-mode-overlay"
                    value={graphModeId}
                    disabled={graphInspectorSource !== 'live'}
                    onChange={(event) => {
                      setGraphModeId(event.target.value);
                      setSelectedNodeId(null);
                      setSelectedEdgeId(null);
                    }}
                    style={{ display: 'block', width: '100%', marginTop: 6, padding: 8 }}
                  >
                    <option value="all">All graph</option>
                    {(graphModeCatalog?.modes ?? []).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label} · r{entry.revision}{entry.active ? '' : ' · dormant'}
                      </option>
                    ))}
                  </select>
                </label>

                <label htmlFor="graph-inspector-search" style={{ display: 'block', marginTop: 14 }}>
                  <strong>Search graph</strong>
                  <input
                    id="graph-inspector-search"
                    type="search"
                    value={graphQuery}
                    onChange={(event) => setGraphQuery(event.target.value)}
                    placeholder="creator, concept, relation, or ID"
                    style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, padding: 8 }}
                  />
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 12,
                  color: '#cbd5e1',
                  fontSize: 12,
                }}>
                  <input
                    type="checkbox"
                    checked={graphFocusOnly}
                    onChange={(event) => setGraphFocusOnly(event.target.checked)}
                  />
                  Focus only on selected mode/search/selection
                </label>
                <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: 11 }}>
                  Turn this off to keep unrelated graph context visible.
                </p>

                {graphSearchResults.length > 0 ? (
                  <div style={{ marginTop: 8, maxHeight: 210, overflow: 'auto' }}>
                    {graphSearchResults.map((result) => (
                      <button
                        key={`${result.type}:${result.id}`}
                        type="button"
                        onClick={() => {
                          if (result.type === 'node') {
                            setSelectedNodeId(result.id);
                            setSelectedEdgeId(null);
                            setContentExplanation(null);
                            setContentExplanationError(null);
                          } else {
                            setSelectedEdgeId(result.id);
                            setSelectedNodeId(null);
                            setContentExplanation(null);
                            setContentExplanationError(null);
                          }
                        }}
                        style={{
                          display: 'block',
                          width: '100%',
                          border: 0,
                          borderTop: '1px solid #263244',
                          padding: '8px 4px',
                          background: 'transparent',
                          color: '#e2e8f0',
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                      >
                        <strong>{result.label}</strong>
                        <div style={{ color: '#94a3b8', fontSize: 11 }}>{result.kind} · {result.type}</div>
                      </button>
                    ))}
                  </div>
                ) : null}

                {graphInspectorSource !== 'live' ? (
                  <p style={{ marginTop: 10, color: '#94a3b8', fontSize: 12 }}>
                    Mode overlays are disabled for pasted snapshots because the durable mode catalog is stored separately from graph exports.
                  </p>
                ) : null}

                <div style={{ marginTop: 16, color: '#cbd5e1', fontSize: 12 }}>
                  <strong>Mode connection</strong>
                  <div style={{ marginTop: 4 }}>
                    {graphModeOverlay.modeId === 'all'
                      ? 'Showing the full graph.'
                      : `${graphModeOverlay.memberNodeIds.length} exact member nodes · ${graphModeOverlay.connectedNodeIds.length} connected nodes · ${graphModeOverlay.connectedEdgeIds.length} connecting edges`}
                  </div>
                </div>

                {graphGroupCoverage ? (
                  <div style={{ marginTop: 14, padding: 10, border: '1px solid #334155', borderRadius: 10, color: '#cbd5e1' }}>
                    <strong>Content grouping coverage</strong>
                    <div style={{ marginTop: 6, display: 'grid', gap: 3, fontSize: 12 }}>
                      <span>{graphGroupCoverage.durableGroupedContentCount} / {graphGroupCoverage.contentCount} content items in durable groups</span>
                      <span>{graphGroupCoverage.topicClusteredContentCount} in provisional topic clusters</span>
                      <span>{graphGroupCoverage.ungroupedContentCount} not yet grouped</span>
                      <span>{graphGroupCoverage.structuralNodeCount} structural nodes (creators, concepts, topics, objectives) — these are not expected to belong to a content group</span>
                    </div>
                  </div>
                ) : null}

                <details style={{ marginTop: 14 }}>
                  <summary>Graph summary</summary>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                    <div>
                      <strong>Node kinds</strong>
                      <ul style={{ paddingLeft: 18 }}>
                        {(effectiveGraphInspector?.nodesByKind ?? []).map((entry) => (
                          <li key={entry.key}>{entry.key}: {entry.count}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>Relations</strong>
                      <ul style={{ paddingLeft: 18 }}>
                        {(effectiveGraphInspector?.edgesByRelation ?? []).map((entry) => (
                          <li key={entry.key}>{entry.key}: {entry.count}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>

                <details style={{ marginTop: 10 }}>
                  <summary>Recent revisions</summary>
                  <ul style={{ paddingLeft: 18 }}>
                    {(effectiveGraphInspector?.revisions ?? []).slice(0, 8).map((revision) => (
                      <li key={`${revision.revision}:${revision.createdAt}`}>
                        r{revision.revision} · {revision.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              </aside>

              <div>
                <GraphCanvas
                  nodes={effectiveGraphInspector?.nodes ?? []}
                  edges={effectiveGraphInspector?.edges ?? []}
                  modeOverlay={graphModeOverlay}
                  searchQuery={graphQuery}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  onNodeSelect={(nodeId) => {
                    setSelectedNodeId(nodeId);
                    setSelectedEdgeId(null);
                    setContentExplanation(null);
                    setContentExplanationError(null);
                  }}
                  onEdgeSelect={(edgeId) => {
                    setSelectedEdgeId(edgeId);
                    setSelectedNodeId(null);
                    setContentExplanation(null);
                    setContentExplanationError(null);
                  }}
                  height={640}
                  focusOnly={graphFocusOnly}
                  layoutMode={graphLayoutMode}
                />

                <div
                  ref={graphInspectorDetailRef}
                  tabIndex={-1}
                  aria-live="polite"
                  style={{
                  marginTop: 12,
                  padding: 12,
                  border: '1px solid #263244',
                  borderRadius: 12,
                  background: '#111827',
                  minHeight: 110,
                  outline: 'none',
                }}>
                  {selectedGraphNode ? (
                    <>
                      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                        {selectedGraphNode.thumbnailUrl ? (
                          <img
                            src={selectedGraphNode.thumbnailUrl}
                            alt=""
                            width={160}
                            height={90}
                            style={{
                              width: 160,
                              height: 90,
                              objectFit: 'cover',
                              borderRadius: 10,
                              border: '1px solid #334155',
                              background: '#0f172a',
                              flex: '0 0 auto',
                            }}
                          />
                        ) : null}
                        <div style={{ minWidth: 0 }}>
                          <h3 style={{ margin: '0 0 6px' }}>{selectedGraphNode.label}</h3>
                          {selectedGraphNode.creatorName ? (
                            <p style={{ margin: '0 0 6px', color: '#cbd5e1' }}>{selectedGraphNode.creatorName}</p>
                          ) : null}
                          <p style={{ margin: '4px 0' }}>
                            {selectedGraphNode.kind} · {selectedGraphNode.provenance}
                            {' · '}{selectedGraphNode.supportCount} support item{selectedGraphNode.supportCount === 1 ? '' : 's'}
                            {selectedGraphNode.confidence == null ? '' : ` · confidence ${selectedGraphNode.confidence.toFixed(2)}`}
                          </p>
                          <code style={{ color: '#93c5fd', overflowWrap: 'anywhere' }}>{selectedGraphNode.id}</code>
                          {graphInspectorSource === 'live' && selectedGraphNode.kind !== 'content' ? (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                              <button type="button" onClick={() => void handleGraphControl('node', selectedGraphNode.id, 'reduce')}>Reduce</button>
                              <button type="button" onClick={() => void handleGraphControl('node', selectedGraphNode.id, 'prefer')}>Prefer</button>
                              <button type="button" onClick={() => void handleGraphControl('node', selectedGraphNode.id, 'mute')}>Mute</button>
                              <button type="button" onClick={() => void handleRemoveGraphControl('node', selectedGraphNode.id)}>Clear control</button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {selectedGraphNode.kind === 'content' && selectedGraphNode.contentExternalId ? (
                        <div style={{ marginTop: 14, borderTop: '1px solid #263244', paddingTop: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              onClick={() => void handleExplainSelectedContent()}
                              disabled={contentExplanationLoading}
                            >
                              {contentExplanationLoading ? 'Explaining…' : contentExplanation ? 'Refresh Why this?' : 'Why this?'}
                            </button>
                            {contentExplanation ? (
                              <span style={{ color: '#94a3b8', fontSize: 12 }}>
                                exact local score · graph r{contentExplanation.explanation?.graphRevision ?? '—'}
                              </span>
                            ) : null}
                          </div>
                          {contentExplanationError ? (
                            <p style={{ color: '#fca5a5', marginBottom: 0 }}>{contentExplanationError}</p>
                          ) : null}

                          {contentExplanation && explanationGraphView && explanationGraphOverlay ? (
                            <div style={{ marginTop: 12 }}>
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 12,
                                alignItems: 'baseline',
                                marginBottom: 8,
                              }}>
                                <div>
                                  <strong>Why this?</strong>
                                  <div style={{ color: '#cbd5e1', fontSize: 12, marginTop: 2 }}>
                                    Score {contentExplanation.score}/100 · raw {contentExplanation.explanation?.rawScore ?? contentExplanation.rawScore}
                                  </div>
                                </div>
                                <code style={{ color: '#94a3b8', fontSize: 10, overflowWrap: 'anywhere' }}>
                                  {contentExplanation.traceId}
                                </code>
                              </div>

                              <GraphCanvas
                                nodes={explanationGraphView.nodes}
                                edges={explanationGraphView.edges}
                                modeOverlay={explanationGraphOverlay}
                                selectedNodeId={selectedGraphNode.id}
                                compact
                                layoutMode="lineage"
                                height={240}
                              />

                              {contentExplanation.explanation?.acquisitionMechanism ? (
                                <p style={{ color: '#94a3b8', fontSize: 11, margin: '8px 0 0' }}>
                                  Acquired via {contentExplanation.explanation.acquisitionMechanism} · source is not preference evidence
                                </p>
                              ) : null}

                              <div style={{ marginTop: 10 }}>
                                {(contentExplanation.explanation?.contributions ?? []).map((contribution, index) => (
                                  <div
                                    key={`${contribution.kind}:${contribution.label}:${index}`}
                                    style={{
                                      display: 'grid',
                                      gridTemplateColumns: '1fr auto',
                                      gap: 10,
                                      padding: '8px 0',
                                      borderTop: '1px solid #263244',
                                    }}
                                  >
                                    <div>
                                      <strong>{contribution.label}</strong>
                                      <div style={{ color: '#94a3b8', fontSize: 11 }}>
                                        {contribution.kind}
                                        {contribution.evidenceIds.length > 0
                                          ? ` · ${contribution.evidenceIds.length} evidence item${contribution.evidenceIds.length === 1 ? '' : 's'}`
                                          : ''}
                                      </div>
                                    </div>
                                    <strong style={{ color: contribution.value >= 0 ? '#86efac' : '#fca5a5' }}>
                                      {contribution.value > 0 ? '+' : ''}{contribution.value}
                                    </strong>
                                  </div>
                                ))}
                              </div>

                              <p style={{ color: '#94a3b8', fontSize: 11, marginBottom: 0 }}>
                                Use the selected graph term controls above, or the inline Why-this action on YouTube. Every change creates a graph revision and can be undone.
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      <div style={{ marginTop: 14, borderTop: '1px solid #263244', paddingTop: 10 }}>
                        <strong>Connected relationships</strong>
                        {selectedGraphNodeEdges.length > 0 ? (
                          <div style={{ marginTop: 6 }}>
                            {selectedGraphNodeEdges.map((edge) => {
                              const outbound = edge.sourceNodeId === selectedGraphNode.id;
                              const otherLabel = outbound ? edge.targetLabel : edge.sourceLabel;
                              return (
                                <button
                                  key={edge.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedEdgeId(edge.id);
                                    setSelectedNodeId(null);
                                  }}
                                  style={{
                                    display: 'block',
                                    width: '100%',
                                    border: 0,
                                    borderTop: '1px solid #263244',
                                    padding: '8px 0',
                                    background: 'transparent',
                                    color: '#e2e8f0',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <strong>{outbound ? '→' : '←'} {otherLabel}</strong>
                                  <div style={{ color: '#94a3b8', fontSize: 11 }}>
                                    {edge.relation} · {edge.provenance} · {edge.evidenceIds.length} support item{edge.evidenceIds.length === 1 ? '' : 's'}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p style={{ color: '#94a3b8' }}>No visible graph relationships for this node.</p>
                        )}
                      </div>
                    </>
                  ) : selectedGraphEdge ? (
                    <>
                      <h3 style={{ margin: '0 0 8px' }}>Relationship provenance</h3>
                      <p style={{ margin: '4px 0' }}>
                        <strong>{selectedGraphEdge.sourceLabel}</strong> → <strong>{selectedGraphEdge.targetLabel}</strong>
                        {' · '}{selectedGraphEdge.relation}
                        {' · '}{selectedGraphEdge.provenance}
                      </p>
                      <code style={{ color: '#93c5fd', overflowWrap: 'anywhere' }}>{selectedGraphEdge.id}</code>
                      {graphInspectorSource === 'live' ? (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                          <button type="button" onClick={() => void handleGraphControl('edge', selectedGraphEdge.id, 'reduce')}>Reduce</button>
                          <button type="button" onClick={() => void handleGraphControl('edge', selectedGraphEdge.id, 'prefer')}>Prefer</button>
                          <button type="button" onClick={() => void handleGraphControl('edge', selectedGraphEdge.id, 'mute')}>Mute</button>
                          <button type="button" onClick={() => void handleRemoveGraphControl('edge', selectedGraphEdge.id)}>Clear control</button>
                        </div>
                      ) : null}
                      <p style={{ color: '#94a3b8', fontSize: 11 }}>
                        Reduce/Prefer adjust an edge only when that edge already carries score. Mute is a hard exact-edge suppression.
                      </p>
                      {selectedGraphEdge.evidence.length > 0 ? (
                        <ul style={{ marginBottom: 0 }}>
                          {selectedGraphEdge.evidence.slice(0, 12).map((evidence) => (
                            <li key={evidence.id} style={{ marginTop: 8 }}>
                              <strong>{evidence.kind === 'interaction' ? evidence.interaction : 'surfaced'}</strong>
                              {' · '}{evidence.contentLabel}
                              {' · '}{evidence.connector}/{evidence.mechanism}
                              {' · '}confidence {evidence.confidence.toFixed(2)}
                              {' · '}{evidence.observedAt}
                              <br />
                              <code style={{ color: '#94a3b8' }}>{evidence.id}</code>
                              {graphInspectorSource === 'live' ? (
                                <button
                                  type="button"
                                  onClick={() => void handleForgetEvidence(evidence.id, selectedGraphEdge.id)}
                                  style={{ marginLeft: 8 }}
                                >
                                  Forget evidence
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No retained supporting evidence is available for this relationship.</p>
                      )}
                    </>
                  ) : (
                    <p style={{ margin: 0, color: '#94a3b8' }}>
                      Select a node or relationship in the graph, or search for one by label or stable ID.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section style={{ marginTop: 32, paddingTop: 20, borderTop: '1px solid #cbd5e1' }}>
        <h2>Delete local data</h2>
        <p>Deletes locally stored evidence, graph state, feed caches, traces, feedback, settings, and disclosure acceptance. Observation remains off until you accept the current disclosure again.</p>
        <button type="button" onClick={() => void handleDeleteLocalData()}>Delete all local MyAlgo data</button>
      </section>
    </main>
  );
}
