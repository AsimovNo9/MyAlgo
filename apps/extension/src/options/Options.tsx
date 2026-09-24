import React from 'react';

export function Options() {
  const [mode, setMode] = React.useState('Work');

  React.useEffect(() => {
    chrome.storage.local.get(['personal-algorithm-mode']).then((result) => {
      setMode((result['personal-algorithm-mode'] as string) ?? 'Work');
    });
  }, []);

  const handleModeChange = async (nextMode: string) => {
    setMode(nextMode);
    await chrome.runtime.sendMessage({ type: 'SET_MODE', payload: { mode: nextMode } });
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
    </main>
  );
}
