import React from 'react';
import { getExtensionAccessToken } from '../lib/auth';
import { fetchAlgorithms } from '../lib/api-client';
import type { Algorithm } from '@repo/shared-types';

export function Popup() {
  const [mode, setMode] = React.useState('Work');
  const [feedCount, setFeedCount] = React.useState(0);
  const [signedIn, setSignedIn] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [algorithms, setAlgorithms] = React.useState<Algorithm[]>([]);

  const refreshAlgorithms = async () => {
    try {
      const availableAlgorithms = await fetchAlgorithms();
      setAlgorithms(availableAlgorithms);
      setAuthError(null);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to load algorithms.');
    }
  };

  React.useEffect(() => {
    chrome.storage.local.get(['personal-algorithm-mode', 'personal-algorithm-feed-cache']).then(async (result) => {
      setMode((result['personal-algorithm-mode'] as string) ?? 'Work');
      setFeedCount(Array.isArray(result['personal-algorithm-feed-cache']) ? result['personal-algorithm-feed-cache'].length : 0);
      const hasSession = Boolean(await getExtensionAccessToken());
      setSignedIn(hasSession);
      setLastError((await chrome.storage.local.get(['personal-algorithm-last-error']))['personal-algorithm-last-error'] as string | null);
      if (hasSession) {
        try {
          const availableAlgorithms = await fetchAlgorithms();
          setAlgorithms(availableAlgorithms);
          const storedMode = (result['personal-algorithm-mode'] as string) ?? '';
          if (!availableAlgorithms.some((algorithm) => algorithm.name === storedMode) && availableAlgorithms[0]) {
            setMode(availableAlgorithms[0].name);
            await chrome.storage.local.set({ 'personal-algorithm-mode': availableAlgorithms[0].name });
          }
        } catch (error) {
          setLastError(error instanceof Error ? error.message : 'Unable to load algorithms.');
        }
      }
    });
  }, []);

  const handleSignIn = async () => {
    setAuthError(null);
    const response = await chrome.runtime.sendMessage({ type: 'SIGN_IN' }) as { ok?: boolean; error?: string };
    if (!response?.ok) {
      setAuthError(response?.error ?? 'Unable to sign in.');
      return;
    }
    setSignedIn(true);
    await refreshAlgorithms();
  };

  const handleSignOut = async () => {
    await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
    setSignedIn(false);
    setFeedCount(0);
  };

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
      <p>Account: <strong>{signedIn ? 'Connected' : 'Not connected'}</strong></p>
      <p>Cached feed items: <strong>{feedCount}</strong></p>
      {lastError ? <p style={{ color: '#b91c1c', maxWidth: 260 }}>Last feed error: {lastError}</p> : null}
      {signedIn ? (
        <button onClick={() => void handleSignOut()}>Sign out</button>
      ) : (
        <button onClick={() => void handleSignIn()}>Sign in with Google</button>
      )}
      {authError ? <p style={{ color: '#b91c1c', maxWidth: 260 }}>{authError}</p> : null}
      {signedIn ? <button onClick={() => void refreshAlgorithms()}>Refresh algorithms</button> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(algorithms.length > 0 ? algorithms.map((algorithm) => algorithm.name) : ['Work', 'Learning', 'Relax']).map((option) => (
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
