import React from 'react';
import { PRIVACY_DISCLOSURE, PRIVACY_DISCLOSURE_VERSION, isPrivacyDisclosureAccepted } from '../lib/privacy';
import {
  buildDurableModeOptions,
  buildGraphInspectorView,
  buildGraphModeOverlay,
  parseGraphInspectorExport,
  type GraphInspectorView,
} from '../lib/extension-helpers';
import { GraphCanvas } from '../components/GraphCanvas';
import type { DurableSemanticModeCatalog } from '@repo/shared-types';

export function Options() {
  const [mode, setMode] = React.useState('Default');
  const [activeModeId, setActiveModeId] = React.useState('default');
  const [durableModeCatalog, setDurableModeCatalog] = React.useState<DurableSemanticModeCatalog | null>(null);
  const [historyObservationEnabled, setHistoryObservationEnabled] = React.useState(false);
  const [homeObservationEnabled, setHomeObservationEnabled] = React.useState(false);
  const [semanticModelMode, setSemanticModelMode] = React.useState<'hash' | 'neural'>('hash');
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
  const [offlineGraphJson, setOfflineGraphJson] = React.useState('');

  React.useEffect(() => {
    chrome.storage.local.get([
      'personal-algorithm-mode',
      'personal-algorithm-active-mode-id',
      'personal-algorithm-durable-mode-catalog',
      'personal-algorithm-history-observation-enabled',
      'personal-algorithm-home-observation-enabled',
      'personal-algorithm-semantic-model-mode',
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
      setDurableModeCatalog(catalog);
      setHistoryObservationEnabled(result['personal-algorithm-history-observation-enabled'] === true);
      setHomeObservationEnabled(result['personal-algorithm-home-observation-enabled'] === true);
      setSemanticModelMode(result['personal-algorithm-semantic-model-mode'] === 'neural' ? 'neural' : 'hash');
      setSemanticModelStatus((result['personal-algorithm-semantic-model-status'] as typeof semanticModelStatus) ?? null);
      setConceptModelStatus((result['personal-algorithm-concept-model-status'] as typeof conceptModelStatus) ?? null);
      const storedBatchSize = Number(result['personal-algorithm-semantic-neural-batch-size'] ?? 1);
      setNeuralBatchSize(Number.isFinite(storedBatchSize) ? Math.max(1, Math.min(16, Math.floor(storedBatchSize))) : 1);
      setDisclosureAccepted(isPrivacyDisclosureAccepted(result['personal-algorithm-privacy-disclosure-accepted-version']));
    });
    const handleStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      const change = changes['personal-algorithm-semantic-model-status'];
      if (change) {
        setSemanticModelStatus((change.newValue as typeof semanticModelStatus) ?? null);
      }
      const conceptChange = changes['personal-algorithm-concept-model-status'];
      if (conceptChange) {
        setConceptModelStatus((conceptChange.newValue as typeof conceptModelStatus) ?? null);
      }
      const catalogChange = changes['personal-algorithm-durable-mode-catalog'];
      if (catalogChange) setDurableModeCatalog((catalogChange.newValue as DurableSemanticModeCatalog | undefined) ?? null);
      const activeModeChange = changes['personal-algorithm-active-mode-id'];
      if (activeModeChange) setActiveModeId((activeModeChange.newValue as string | undefined) ?? 'default');
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
    setHomeObservationEnabled(false);
    setSemanticModelMode('hash');
    setSemanticModelStatus(null);
    setConceptModelStatus(null);
    setNeuralBatchSize(1);
    setMode('Default');
    setActiveModeId('default');
    setDurableModeCatalog(null);
    setGraphInspector(null);
    setGraphInspectorSource(null);
    setGraphModeId('all');
    setGraphFocusOnly(true);
    setGraphLayoutMode('network');
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setOfflineGraphJson('');
    setStatus('Local MyAlgo data deleted. Accept the disclosure again before observation resumes.');
  };

  const handleModeChange = async (nextModeId: string) => {
    const response = await chrome.runtime.sendMessage({
      type: 'SET_MODE',
      payload: { modeId: nextModeId },
    }) as { ok?: boolean; error?: string; mode?: string; modeId?: string };
    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to change mode.');
      return;
    }
    setActiveModeId(response.modeId ?? nextModeId);
    setMode(response.mode ?? 'Default');
    setStatus(null);
  };

  const handleHistoryObservationChange = async (enabled: boolean) => {
    setHistoryObservationEnabled(enabled);
    await chrome.storage.local.set({ 'personal-algorithm-history-observation-enabled': enabled });
  };

  const handleHomeObservationChange = async (enabled: boolean) => {
    setHomeObservationEnabled(enabled);
    await chrome.storage.local.set({ 'personal-algorithm-home-observation-enabled': enabled });
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
      error?: string;
    };
    if (!response?.ok || !response.state) {
      setStatus(response?.error ?? 'Unable to inspect the local Personal Algorithm Graph.');
      return;
    }
    try {
      const view = buildGraphInspectorView(response.state);
      setGraphInspector(view);
      setGraphInspectorSource('live');
      setGraphModeId('all');
      setGraphFocusOnly(true);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to inspect the local Personal Algorithm Graph.');
    }
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
  const normalizedGraphQuery = graphQuery.trim().toLowerCase();
  const filteredGraphNodes = (graphInspector?.nodes ?? []).filter((node) => (
    !normalizedGraphQuery
    || node.label.toLowerCase().includes(normalizedGraphQuery)
    || node.id.toLowerCase().includes(normalizedGraphQuery)
    || node.kind.toLowerCase().includes(normalizedGraphQuery)
  )).slice(0, 80);
  const filteredGraphEdges = (graphInspector?.edges ?? []).filter((edge) => (
    !normalizedGraphQuery
    || edge.relation.toLowerCase().includes(normalizedGraphQuery)
    || edge.sourceLabel.toLowerCase().includes(normalizedGraphQuery)
    || edge.targetLabel.toLowerCase().includes(normalizedGraphQuery)
    || edge.id.toLowerCase().includes(normalizedGraphQuery)
  )).slice(0, 80);
  const graphModeCatalog = graphInspectorSource === 'live' ? durableModeCatalog : null;
  const graphModeOverlay = graphInspector
    ? buildGraphModeOverlay(graphInspector, graphModeCatalog, graphModeId)
    : buildGraphModeOverlay({
        schemaVersion: 2,
        graphRevision: 0,
        evidenceCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        nodesByKind: [],
        edgesByRelation: [],
        nodes: [],
        edges: [],
        revisions: [],
      }, durableModeCatalog, 'all');
  const selectedGraphNode = graphInspector?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedGraphEdge = graphInspector?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
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

      <section style={{ marginBottom: 24 }}>
        <h2>Mode</h2>
        <select value={activeModeId} onChange={(event) => void handleModeChange(event.target.value)} style={{ padding: 8, minWidth: 240 }}>
          {modeOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}{option.active ? '' : ' (dormant)'}
            </option>
          ))}
        </select>
        <p>Modes are persisted clusters over canonical Personal Algorithm concepts rather than labels from the current feed.</p>
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
          for semantic similarity and DeBERTa-v3-xsmall NLI for bounded zero-shot concept verification. Candidate text, verified
          concepts, graph state, embeddings, and inference stay local. The installed extension does not download
          model files at runtime. Embeddings prefer WebGPU and fall back to local WebAssembly CPU inference when needed.
          The concept verifier deliberately uses q8 WebAssembly CPU inference, which is independent of the embedding batch slider.
          Concept verification remains asynchronous and falls back to the existing metadata materializer only when verification fails.
        </p>
        <p><strong>Current semantic provider:</strong> {semanticModelMode === 'neural' ? 'Neural local (WebGPU embeddings + WASM concept verification)' : 'Deterministic baseline'}</p>
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
        <h2>Personal Algorithm Graph explorer</h2>
        <p>
          Explore the current local graph visually, search stable graph IDs, switch between durable mode overlays,
          and inspect exact retained evidence. This surface is read-only and does not edit preferences.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <button type="button" onClick={() => void handleLoadLiveGraph()}>Load live graph</button>
          {graphInspector ? (
            <span>
              {graphInspectorSource === 'live' ? 'Live snapshot' : 'Offline pasted snapshot'}
              {' · '}graph r{graphInspector.graphRevision}
              {' · '}{graphInspector.nodeCount} nodes
              {' · '}{graphInspector.edgeCount} edges
              {' · '}{graphInspector.evidenceCount} evidence records
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
                  <strong>Mode overlay</strong>
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
                          } else {
                            setSelectedEdgeId(result.id);
                            setSelectedNodeId(null);
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

                <details style={{ marginTop: 14 }}>
                  <summary>Graph summary</summary>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                    <div>
                      <strong>Node kinds</strong>
                      <ul style={{ paddingLeft: 18 }}>
                        {graphInspector.nodesByKind.map((entry) => (
                          <li key={entry.key}>{entry.key}: {entry.count}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <strong>Relations</strong>
                      <ul style={{ paddingLeft: 18 }}>
                        {graphInspector.edgesByRelation.map((entry) => (
                          <li key={entry.key}>{entry.key}: {entry.count}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>

                <details style={{ marginTop: 10 }}>
                  <summary>Recent revisions</summary>
                  <ul style={{ paddingLeft: 18 }}>
                    {graphInspector.revisions.slice(0, 8).map((revision) => (
                      <li key={`${revision.revision}:${revision.createdAt}`}>
                        r{revision.revision} · {revision.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              </aside>

              <div>
                <GraphCanvas
                  nodes={graphInspector.nodes}
                  edges={graphInspector.edges}
                  modeOverlay={graphModeOverlay}
                  searchQuery={graphQuery}
                  selectedNodeId={selectedNodeId}
                  selectedEdgeId={selectedEdgeId}
                  onNodeSelect={(nodeId) => {
                    setSelectedNodeId(nodeId);
                    setSelectedEdgeId(null);
                  }}
                  onEdgeSelect={(edgeId) => {
                    setSelectedEdgeId(edgeId);
                    setSelectedNodeId(null);
                  }}
                  height={640}
                  focusOnly={graphFocusOnly}
                  layoutMode={graphLayoutMode}
                />

                <div style={{
                  marginTop: 12,
                  padding: 12,
                  border: '1px solid #263244',
                  borderRadius: 12,
                  background: '#111827',
                  minHeight: 110,
                }}>
                  {selectedGraphNode ? (
                    <>
                      <h3 style={{ margin: '0 0 8px' }}>{selectedGraphNode.label}</h3>
                      <p style={{ margin: '4px 0' }}>
                        {selectedGraphNode.kind} · {selectedGraphNode.provenance}
                        {' · '}{selectedGraphNode.supportCount} support item{selectedGraphNode.supportCount === 1 ? '' : 's'}
                        {selectedGraphNode.confidence == null ? '' : ` · confidence ${selectedGraphNode.confidence.toFixed(2)}`}
                      </p>
                      <code style={{ color: '#93c5fd', overflowWrap: 'anywhere' }}>{selectedGraphNode.id}</code>
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
                      {selectedGraphEdge.evidence.length > 0 ? (
                        <ul style={{ marginBottom: 0 }}>
                          {selectedGraphEdge.evidence.slice(0, 12).map((evidence) => (
                            <li key={evidence.id} style={{ marginTop: 8 }}>
                              <strong>{evidence.kind === 'interaction' ? evidence.interaction : 'surfaced'}</strong>
                              {' · '}{evidence.contentLabel}
                              {' · '}{evidence.connector}/{evidence.mechanism}
                              {' · '}{evidence.observedAt}
                              <br />
                              <code style={{ color: '#94a3b8' }}>{evidence.id}</code>
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
