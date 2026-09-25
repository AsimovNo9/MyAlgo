import React from 'react';

export function Options() {
  const [mode, setMode] = React.useState('Work');
  const [historyObservationEnabled, setHistoryObservationEnabled] = React.useState(false);
  const [homeObservationEnabled, setHomeObservationEnabled] = React.useState(false);
  const [scanStatus, setScanStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    chrome.storage.local.get(['personal-algorithm-mode', 'personal-algorithm-history-observation-enabled', 'personal-algorithm-home-observation-enabled']).then((result) => {
      setMode((result['personal-algorithm-mode'] as string) ?? 'Work');
      setHistoryObservationEnabled(result['personal-algorithm-history-observation-enabled'] === true);
      setHomeObservationEnabled(result['personal-algorithm-home-observation-enabled'] === true);
    });
  }, []);

  const handleModeChange = async (nextMode: string) => {
    setMode(nextMode);
    await chrome.runtime.sendMessage({ type: 'SET_MODE', payload: { mode: nextMode } });
  };

  const handleHistoryObservationChange = async (enabled: boolean) => {
    setHistoryObservationEnabled(enabled);
    await chrome.storage.local.set({ 'personal-algorithm-history-observation-enabled': enabled });
    if (enabled) await startObservationScan('history');
  };

  const handleHomeObservationChange = async (enabled: boolean) => {
    setHomeObservationEnabled(enabled);
    await chrome.storage.local.set({ 'personal-algorithm-home-observation-enabled': enabled });
    if (enabled) await startObservationScan('home');
  };

  const startObservationScan = async (surface: 'history' | 'home') => {
    const response = await chrome.runtime.sendMessage({ type: 'SCAN_OBSERVATIONS', payload: { surface } }) as { ok?: boolean; error?: string };
    setScanStatus(response?.ok
      ? surface === 'history' ? 'History scan started in the active YouTube tab.' : 'Home snapshot collected from the active YouTube tab.'
      : response?.error ?? 'Unable to start observation scan.');
  };

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Personal Algorithm settings</h1>

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
        <button disabled={!historyObservationEnabled} onClick={() => void startObservationScan('history')}>Scan all loaded History</button>
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
        <button disabled={!homeObservationEnabled} onClick={() => void startObservationScan('home')}>Capture current Home snapshot</button>
      </section>

      {scanStatus ? <p role="status">{scanStatus}</p> : null}
    </main>
  );
}
