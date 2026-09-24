import React from 'react';
import { summarizeFeed, type FeedSummary } from '../lib/extension-helpers';
import type { FeedItem, FeedSourceFilters } from '@repo/shared-types';

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
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [enabled, setEnabled] = React.useState(true);
  const [sourceFilters, setSourceFilters] = React.useState<FeedSourceFilters>(defaultSourceFilters);
  const [feedSummary, setFeedSummary] = React.useState<FeedSummary>(emptyFeedSummary);

  React.useEffect(() => {
    chrome.storage.local.get(['personal-algorithm-mode', 'personal-algorithm-feed-cache', 'personal-algorithm-enabled', 'personal-algorithm-source-filters', 'personal-algorithm-last-error']).then((result) => {
      setMode((result['personal-algorithm-mode'] as string) ?? 'Work');
      const cachedFeed = result['personal-algorithm-feed-cache'] as FeedItem[] | undefined;
      setFeedCount(Array.isArray(cachedFeed) ? cachedFeed.length : 0);
      setFeedSummary(Array.isArray(cachedFeed) ? summarizeFeed(cachedFeed) : emptyFeedSummary);
      setEnabled(result['personal-algorithm-enabled'] !== false);
      setSourceFilters({ ...defaultSourceFilters, ...(result['personal-algorithm-source-filters'] as FeedSourceFilters | undefined) });
      setLastError(result['personal-algorithm-last-error'] as string | null);
    });
  }, []);

  const handleSetMode = async (nextMode: string) => {
    setMode(nextMode);
    const response = await chrome.runtime.sendMessage({ type: 'SET_MODE', payload: { mode: nextMode } }) as { ok?: boolean; error?: string };
    if (!response?.ok) {
      setLastError(response?.error ?? 'Unable to change mode.');
      return;
    }
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

  const modeOptions = ['Work', 'Learning', 'Relax'];

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
      <button onClick={() => void handleToggleEnabled()}>{enabled ? 'Pause extension' : 'Activate extension'}</button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {modeOptions.map((option) => (
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
