import React from 'react';
import { PRIVACY_DISCLOSURE, PRIVACY_DISCLOSURE_VERSION, isPrivacyDisclosureAccepted } from '../lib/privacy';

export function Options() {
  const [mode, setMode] = React.useState('Work');
  const [historyObservationEnabled, setHistoryObservationEnabled] = React.useState(false);
  const [homeObservationEnabled, setHomeObservationEnabled] = React.useState(false);
  const [semanticModelMode, setSemanticModelMode] = React.useState<'hash' | 'neural'>('hash');
  const [semanticModelStatus, setSemanticModelStatus] = React.useState<{
    status?: string;
    progress?: number | null;
    backend?: string;
    file?: string | null;
  } | null>(null);
  const [disclosureAccepted, setDisclosureAccepted] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    chrome.storage.local.get([
      'personal-algorithm-mode',
      'personal-algorithm-history-observation-enabled',
      'personal-algorithm-home-observation-enabled',
      'personal-algorithm-semantic-model-mode',
      'personal-algorithm-semantic-model-status',
      'personal-algorithm-privacy-disclosure-accepted-version',
    ]).then((result) => {
      setMode((result['personal-algorithm-mode'] as string) ?? 'Work');
      setHistoryObservationEnabled(result['personal-algorithm-history-observation-enabled'] === true);
      setHomeObservationEnabled(result['personal-algorithm-home-observation-enabled'] === true);
      setSemanticModelMode(result['personal-algorithm-semantic-model-mode'] === 'neural' ? 'neural' : 'hash');
      setSemanticModelStatus((result['personal-algorithm-semantic-model-status'] as typeof semanticModelStatus) ?? null);
      setDisclosureAccepted(isPrivacyDisclosureAccepted(result['personal-algorithm-privacy-disclosure-accepted-version']));
    });
    const handleStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return;
      const change = changes['personal-algorithm-semantic-model-status'];
      if (change) {
        setSemanticModelStatus((change.newValue as typeof semanticModelStatus) ?? null);
      }
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
    setMode('Work');
    setStatus('Local MyAlgo data deleted. Accept the disclosure again before observation resumes.');
  };

  const handleModeChange = async (nextMode: string) => {
    setMode(nextMode);
    await chrome.runtime.sendMessage({ type: 'SET_MODE', payload: { mode: nextMode } });
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
    setStatus(enabled
      ? 'Neural semantic model enabled. Model weights will download automatically on first semantic pass.'
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
        <select value={mode} onChange={(event) => void handleModeChange(event.target.value)} style={{ padding: 8, minWidth: 240 }}>
          {['Work', 'Learning', 'Relax'].map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
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
          Use the neural semantic encoder
        </label>
        <p>
          When enabled, MyAlgo automatically downloads the public mixedbread-ai/mxbai-embed-xsmall-v1
          model weights on the first semantic pass. Candidate and graph text stay local; only the public model
          files are downloaded. The sandboxed WebGPU runtime keeps the loaded model in memory while active;
          a full extension reload can require downloading the model files again. WebGPU is required for this first neural
          implementation. If loading or inference fails, MyAlgo falls back to the deterministic local baseline.
        </p>
        <p><strong>Current semantic provider:</strong> {semanticModelMode === 'neural' ? 'Neural WebGPU' : 'Deterministic baseline'}</p>
        {semanticModelStatus ? (
          <p role="status">
            <strong>Model status:</strong> {semanticModelStatus.status ?? 'unknown'}
            {typeof semanticModelStatus.progress === 'number' ? ` · ${semanticModelStatus.progress.toFixed(1)}%` : ''}
            {semanticModelStatus.backend ? ` · ${semanticModelStatus.backend}` : ''}
            {semanticModelStatus.file ? ` · ${semanticModelStatus.file}` : ''}
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
        <h2>Delete local data</h2>
        <p>Deletes locally stored evidence, graph state, feed caches, traces, feedback, settings, and disclosure acceptance. Observation remains off until you accept the current disclosure again.</p>
        <button type="button" onClick={() => void handleDeleteLocalData()}>Delete all local MyAlgo data</button>
      </section>
    </main>
  );
}
