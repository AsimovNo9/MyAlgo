import React from 'react';
import { getExtensionAccessToken } from '../lib/auth';
import { fetchAlgorithms } from '../lib/api-client';
import { summarizeFeed, type FeedSummary } from '../lib/extension-helpers';
import type { Algorithm, AlgorithmActivationResponse, FeedItem } from '@repo/shared-types';
import type { FeedSourceFilters } from '@repo/shared-types';

const defaultSourceFilters: FeedSourceFilters = {
  subscribedOnly: false,
  includeDiscovery: true,
  includeShorts: true,
  includeLive: true,
};

const emptyFeedSummary: FeedSummary = { subscribedCount: 0, discoveredCount: 0, topTopics: [] };

export function Popup() {
  const [mode, setMode] = React.useState('Work');
  const [feedCount, setFeedCount] = React.useState(0);
  const [signedIn, setSignedIn] = React.useState(false);
  const [authError, setAuthError] = React.useState<string | null>(null);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [algorithms, setAlgorithms] = React.useState<Algorithm[]>([]);
  const [enabled, setEnabled] = React.useState(true);
  const [sourceFilters, setSourceFilters] = React.useState<FeedSourceFilters>(defaultSourceFilters);
  const [feedSummary, setFeedSummary] = React.useState<FeedSummary>(emptyFeedSummary);
  const [activationStatus, setActivationStatus] = React.useState<string | null>(null);

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
    chrome.storage.local.get(['personal-algorithm-mode', 'personal-algorithm-feed-cache', 'personal-algorithm-enabled', 'personal-algorithm-source-filters']).then(async (result) => {
      setMode((result['personal-algorithm-mode'] as string) ?? 'Work');
      const cachedFeed = result['personal-algorithm-feed-cache'] as FeedItem[] | undefined;
      setFeedCount(Array.isArray(cachedFeed) ? cachedFeed.length : 0);
      setFeedSummary(Array.isArray(cachedFeed) ? summarizeFeed(cachedFeed) : emptyFeedSummary);
      setEnabled(result['personal-algorithm-enabled'] !== false);
      setSourceFilters({ ...defaultSourceFilters, ...(result['personal-algorithm-source-filters'] as FeedSourceFilters | undefined) });
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

  const handleSetMode = async (nextMode: string, algorithmId?: string) => {
    setMode(nextMode);
    setActivationStatus('Finding the best available feed…');
    const response = await chrome.runtime.sendMessage({ type: 'SET_MODE', payload: { mode: nextMode, algorithmId } }) as { ok?: boolean; activation?: AlgorithmActivationResponse; error?: string };
    if (!response?.ok) {
      setActivationStatus(response?.error ?? 'Unable to activate algorithm.');
      return;
    }
    const tier = response.activation?.tier;
    setActivationStatus(tier === 0 ? 'Using the shared content library.' : tier === 1 ? 'Added content from trusted channels.' : tier === 2 ? 'Expanded this topic with new sources.' : null);
    const result = await chrome.storage.local.get(['personal-algorithm-feed-cache']);
    const cachedFeed = result['personal-algorithm-feed-cache'] as FeedItem[] | undefined;
    setFeedCount(Array.isArray(cachedFeed) ? cachedFeed.length : 0);
    setFeedSummary(Array.isArray(cachedFeed) ? summarizeFeed(cachedFeed) : emptyFeedSummary);
  };

  const handleToggleEnabled = async () => {
    const nextEnabled = !enabled;
    const response = await chrome.runtime.sendMessage({ type: 'SET_ENABLED', payload: { enabled: nextEnabled } }) as { ok?: boolean; enabled?: boolean };
    if (response?.ok) {
      setEnabled(response.enabled !== false);
    }
  };

  const handleFilterChange = async (key: keyof FeedSourceFilters, value: boolean) => {
    const nextFilters = { ...sourceFilters, [key]: value };
    setSourceFilters(nextFilters);
    await chrome.runtime.sendMessage({ type: 'SET_SOURCE_FILTERS', payload: { sourceFilters: nextFilters } });
  };

  const algorithmOptions: Algorithm[] = algorithms.length > 0
    ? algorithms
    : ['Work', 'Learning', 'Relax'].map((name) => ({ name }));

  return (
    <main style={{ minWidth: 260, padding: 16, fontFamily: 'sans-serif' }}>
      <h2 style={{ marginTop: 0 }}>Personal Algorithm</h2>
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderRadius: 999,
        background: enabled ? '#dcfce7' : '#e5e7eb',
        color: enabled ? '#166534' : '#374151',
        border: `1px solid ${enabled ? '#86efac' : '#cbd5e1'}`,
        fontWeight: 700,
        marginBottom: 12,
      }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: enabled ? '#22c55e' : '#9ca3af', display: 'inline-block' }} />
        {enabled ? 'Enabled' : 'Paused'}
      </div>
      <p>Current mode: <strong>{mode}</strong></p>
      <p>Account: <strong>{signedIn ? 'Connected' : 'Not connected'}</strong></p>
      <p>Status: <strong>{enabled ? 'Active' : 'Paused'}</strong></p>
      <p>Cached feed items: <strong>{feedCount}</strong></p>
      <p>Feed mix: <strong>{feedSummary.subscribedCount} subscribed</strong> · <strong>{feedSummary.discoveredCount} discovered</strong></p>
      {feedSummary.topTopics.length > 0 ? (
        <p>Top topics: {feedSummary.topTopics.map((entry) => `${entry.topic} (${entry.count})`).join(', ')}</p>
      ) : null}
      <fieldset>
        <legend>Feed controls</legend>
        <label><input type="checkbox" checked={sourceFilters.subscribedOnly} onChange={(event) => void handleFilterChange('subscribedOnly', event.target.checked)} /> Subscribed only</label>
        <label><input type="checkbox" checked={!sourceFilters.includeDiscovery} onChange={(event) => void handleFilterChange('includeDiscovery', !event.target.checked)} /> Hide discovery</label>
        <label><input type="checkbox" checked={!sourceFilters.includeShorts} onChange={(event) => void handleFilterChange('includeShorts', !event.target.checked)} /> Hide Shorts</label>
        <label><input type="checkbox" checked={!sourceFilters.includeLive} onChange={(event) => void handleFilterChange('includeLive', !event.target.checked)} /> Hide live</label>
      </fieldset>
      {lastError ? <p style={{ color: '#b91c1c', maxWidth: 260 }}>Last feed error: {lastError}</p> : null}
      {activationStatus ? <p style={{ color: '#334155', maxWidth: 260 }}>{activationStatus}</p> : null}
      {signedIn ? (
        <button onClick={() => void handleSignOut()}>Sign out</button>
      ) : (
        <button onClick={() => void handleSignIn()}>Sign in with Google</button>
      )}
      {authError ? <p style={{ color: '#b91c1c', maxWidth: 260 }}>{authError}</p> : null}
      {signedIn ? <button onClick={() => void refreshAlgorithms()}>Refresh algorithms</button> : null}
      <button onClick={() => void handleToggleEnabled()}>{enabled ? 'Pause extension' : 'Activate extension'}</button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {algorithmOptions.map((option) => (
          <button key={option.id ?? option.name} onClick={() => void handleSetMode(option.name, option.id)}>
            {option.name}
          </button>
        ))}
      </div>
      <button onClick={() => void chrome.runtime.openOptionsPage()} style={{ marginTop: 12 }}>
        Open options
      </button>
    </main>
  );
}
