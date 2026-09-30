import React from 'react';
import { PRIVACY_DISCLOSURE, PRIVACY_DISCLOSURE_VERSION, isPrivacyDisclosureAccepted } from '../lib/privacy';
import {
  buildDurableModeOptions,
  buildGraphInspectorView,
  parseGraphInspectorExport,
  type GraphInspectorView,
} from '../lib/extension-helpers';
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
  const selectedGraphEdge = graphInspector?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
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
        <h2>Personal Algorithm Graph inspector</h2>
        <p>
          Read the current local graph or inspect a pasted MyAlgo export without changing live graph state.
          This view shows symbolic nodes, relationships, evidence support, and revision history; it does not edit preferences.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" onClick={() => void handleLoadLiveGraph()}>Inspect live graph</button>
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
            Paste the JSON produced by MyAlgo export. Parsing happens only in this Settings page and does not write it into local state.
          </p>
          <textarea
            value={offlineGraphJson}
            onChange={(event) => setOfflineGraphJson(event.target.value)}
            rows={8}
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
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
              <div>
                <strong>Node kinds</strong>
                <ul>
                  {graphInspector.nodesByKind.map((entry) => (
                    <li key={entry.key}>{entry.key}: {entry.count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Relations</strong>
                <ul>
                  {graphInspector.edgesByRelation.map((entry) => (
                    <li key={entry.key}>{entry.key}: {entry.count}</li>
                  ))}
                </ul>
              </div>
              <div>
                <strong>Recent revisions</strong>
                <ul>
                  {graphInspector.revisions.slice(0, 6).map((revision) => (
                    <li key={`${revision.revision}:${revision.createdAt}`}>
                      r{revision.revision} · {revision.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <label htmlFor="graph-inspector-search">
              Search nodes and edges
              <input
                id="graph-inspector-search"
                type="search"
                value={graphQuery}
                onChange={(event) => setGraphQuery(event.target.value)}
                placeholder="concept, creator, relation, or ID"
                style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 6, padding: 8 }}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16, marginTop: 16 }}>
              <div>
                <h3>Nodes</h3>
                <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  {filteredGraphNodes.map((node) => (
                    <div key={node.id} style={{ padding: 10, borderBottom: '1px solid #e2e8f0' }}>
                      <strong>{node.label}</strong>
                      <div>{node.kind} · {node.provenance} · {node.supportCount} support item{node.supportCount === 1 ? '' : 's'}</div>
                      <code style={{ overflowWrap: 'anywhere' }}>{node.id}</code>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3>Edges</h3>
                <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  {filteredGraphEdges.map((edge) => (
                    <button
                      key={edge.id}
                      type="button"
                      onClick={() => setSelectedEdgeId(edge.id)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: 10,
                        textAlign: 'left',
                        border: 0,
                        borderBottom: '1px solid #e2e8f0',
                        background: selectedEdgeId === edge.id ? '#e2e8f0' : 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      <strong>{edge.sourceLabel} → {edge.targetLabel}</strong>
                      <div>{edge.relation} · {edge.provenance} · {edge.evidenceIds.length} support item{edge.evidenceIds.length === 1 ? '' : 's'}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {selectedGraphEdge ? (
              <div style={{ marginTop: 16, padding: 12, border: '1px solid #cbd5e1', borderRadius: 8 }}>
                <h3 style={{ marginTop: 0 }}>Relationship provenance</h3>
                <p>
                  <strong>{selectedGraphEdge.sourceLabel}</strong> → <strong>{selectedGraphEdge.targetLabel}</strong>
                  {' · '}{selectedGraphEdge.relation}
                  {' · '}{selectedGraphEdge.provenance}
                </p>
                <code style={{ overflowWrap: 'anywhere' }}>{selectedGraphEdge.id}</code>
                {selectedGraphEdge.evidence.length > 0 ? (
                  <ul>
                    {selectedGraphEdge.evidence.map((evidence) => (
                      <li key={evidence.id} style={{ marginTop: 8 }}>
                        <strong>{evidence.kind === 'interaction' ? evidence.interaction : 'surfaced'}</strong>
                        {' · '}{evidence.contentLabel}
                        {' · '}{evidence.connector}/{evidence.mechanism}
                        {' · '}{evidence.observedAt}
                        <br />
                        <code>{evidence.id}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No retained supporting evidence is available for this relationship.</p>
                )}
              </div>
            ) : null}
          </>
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
