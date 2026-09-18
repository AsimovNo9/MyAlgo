import React from 'react';

export function Popup() {
  const [mode, setMode] = React.useState('Work');
  const [feedCount, setFeedCount] = React.useState(0);

  React.useEffect(() => {
    chrome.storage.local.get(['personal-algorithm-mode', 'personal-algorithm-feed-cache']).then((result) => {
      setMode((result['personal-algorithm-mode'] as string) ?? 'Work');
      setFeedCount(Array.isArray(result['personal-algorithm-feed-cache']) ? result['personal-algorithm-feed-cache'].length : 0);
    });
  }, []);

  const handleSetMode = async (nextMode: string) => {
    setMode(nextMode);
    await chrome.runtime.sendMessage({ type: 'SET_MODE', payload: { mode: nextMode } });
    const result = await chrome.storage.local.get(['personal-algorithm-feed-cache']);
    setFeedCount(Array.isArray(result['personal-algorithm-feed-cache']) ? result['personal-algorithm-feed-cache'].length : 0);
  };

  return (
    <main style={{ minWidth: 260, padding: 16, fontFamily: 'sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>Personal Algorithm</h2>
      <p>Current mode: <strong>{mode}</strong></p>
      <p>Cached feed items: <strong>{feedCount}</strong></p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['Work', 'Learning', 'Relax'].map((option) => (
          <button key={option} onClick={() => void handleSetMode(option)}>
            {option}
          </button>
        ))}
      </div>
      <button onClick={() => void chrome.runtime.openOptionsPage()} style={{ marginTop: 12 }}>
        Open options
      </button>
    </main>
  );
}
