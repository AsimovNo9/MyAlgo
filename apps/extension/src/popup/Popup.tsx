import React from 'react';
import { summarizeFeed, type FeedSummary } from '../lib/extension-helpers';
import type { FeedItem, FeedSourceFilters, RetrievalDiagnostics, RetrievalSettings } from '@repo/shared-types';
import { PRIVACY_DISCLOSURE, PRIVACY_DISCLOSURE_VERSION, isPrivacyDisclosureAccepted } from '../lib/privacy';

const defaultSourceFilters: FeedSourceFilters = {
  subscribedOnly: false,
  includeDiscovery: true,
  includeShorts: true,
  includeLive: true,
  includePlayables: true,
};

const defaultRetrievalSettings: RetrievalSettings = {
  rssEnabled: false,
  webSearchEnabled: false,
  webSearchEndpoint: null,
};

const emptyRetrievalDiagnostics: RetrievalDiagnostics = {
  lastRssSyncAt: null,
  nextRssAllowedAt: null,
  rssChannelsConsidered: 0,
  rssFeedsSucceeded: 0,
  rssFeedsFailed: 0,
  rssCandidatesFetched: 0,
  rssCandidatesAdded: 0,
  rssCandidatesDeduplicated: 0,
  rssConsecutiveFailures: 0,
  lastWebSearchAt: null,
  nextWebSearchAllowedAt: null,
  webSearchPlansAttempted: 0,
  webSearchPlansSucceeded: 0,
  webSearchCandidatesFetched: 0,
  webSearchCandidatesAdded: 0,
  webSearchCandidatesDeduplicated: 0,
  webSearchConsecutiveFailures: 0,
  lastError: null,
};

const emptyFeedSummary: FeedSummary = { subscribedCount: 0, discoveredCount: 0, topTopics: [] };

export function Popup() {
  const [mode, setMode] = React.useState('Work');
  const [feedCount, setFeedCount] = React.useState(0);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = React.useState(false);
  const [sourceFilters, setSourceFilters] = React.useState<FeedSourceFilters>(defaultSourceFilters);
  const [retrievalSettings, setRetrievalSettings] = React.useState<RetrievalSettings>(defaultRetrievalSettings);
  const [retrievalDiagnostics, setRetrievalDiagnostics] = React.useState<RetrievalDiagnostics>(emptyRetrievalDiagnostics);
  const [retrievalBusy, setRetrievalBusy] = React.useState(false);
  const [webSearchEndpoint, setWebSearchEndpoint] = React.useState('');
  const [feedSummary, setFeedSummary] = React.useState<FeedSummary>(emptyFeedSummary);

  React.useEffect(() => {
    chrome.storage.local.get(['personal-algorithm-mode', 'personal-algorithm-feed-cache', 'personal-algorithm-enabled', 'personal-algorithm-source-filters', 'personal-algorithm-retrieval-settings', 'personal-algorithm-retrieval-diagnostics', 'personal-algorithm-last-error', 'personal-algorithm-privacy-disclosure-accepted-version']).then((result) => {
      setMode((result['personal-algorithm-mode'] as string) ?? 'Work');
      const cachedFeed = result['personal-algorithm-feed-cache'] as FeedItem[] | undefined;
      setFeedCount(Array.isArray(cachedFeed) ? cachedFeed.length : 0);
      setFeedSummary(Array.isArray(cachedFeed) ? summarizeFeed(cachedFeed) : emptyFeedSummary);
      setDisclosureAccepted(isPrivacyDisclosureAccepted(result['personal-algorithm-privacy-disclosure-accepted-version']));
      setEnabled(isPrivacyDisclosureAccepted(result['personal-algorithm-privacy-disclosure-accepted-version']) && result['personal-algorithm-enabled'] !== false);
      setSourceFilters({ ...defaultSourceFilters, ...(result['personal-algorithm-source-filters'] as FeedSourceFilters | undefined) });
      const nextRetrievalSettings = { ...defaultRetrievalSettings, ...(result['personal-algorithm-retrieval-settings'] as RetrievalSettings | undefined) };
      setRetrievalSettings(nextRetrievalSettings);
      setWebSearchEndpoint(nextRetrievalSettings.webSearchEndpoint ?? '');
      setRetrievalDiagnostics({ ...emptyRetrievalDiagnostics, ...(result['personal-algorithm-retrieval-diagnostics'] as RetrievalDiagnostics | undefined) });
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

  const handleAcceptDisclosure = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'ACCEPT_PRIVACY_DISCLOSURE' }) as { ok?: boolean; error?: string };
    if (!response?.ok) {
      setLastError(response?.error ?? 'Unable to save privacy disclosure acceptance.');
      return;
    }
    setDisclosureAccepted(true);
    setEnabled(true);
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
    const response = await chrome.runtime.sendMessage({
      type: 'SET_SOURCE_FILTERS',
      payload: { sourceFilters: nextFilters },
    }) as { ok?: boolean; error?: string };
    if (!response?.ok) {
      setLastError(response?.error ?? 'Unable to update feed controls.');
    } else {
      setLastError(null);
    }
  };

  const updateRetrievalSettings = async (nextSettings: RetrievalSettings) => {
    const previousSettings = retrievalSettings;
    setRetrievalSettings(nextSettings);
    setRetrievalBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_RETRIEVAL_SETTINGS',
        payload: { retrievalSettings: nextSettings },
      }) as { ok?: boolean; error?: string; diagnostics?: RetrievalDiagnostics };
      if (!response?.ok) {
        setRetrievalSettings(previousSettings);
        setLastError(response?.error ?? 'Unable to update retrieval settings.');
        return false;
      }
      if (response.diagnostics) setRetrievalDiagnostics(response.diagnostics);
      setLastError(null);
      return true;
    } finally {
      setRetrievalBusy(false);
    }
  };

  const handleRetrievalChange = async (rssEnabled: boolean) => {
    await updateRetrievalSettings({ ...retrievalSettings, rssEnabled });
  };

  const handleWebSearchChange = async (webSearchEnabled: boolean) => {
    let endpoint: URL;
    try {
      endpoint = new URL(webSearchEndpoint.trim());
      if (endpoint.protocol !== 'https:') throw new Error('HTTPS required');
    } catch {
      setLastError('Enter a valid HTTPS SearXNG endpoint before enabling web search.');
      return;
    }

    const originPattern = `${endpoint.origin}/*`;
    if (webSearchEnabled) {
      const granted = await chrome.permissions.request({
        origins: [originPattern],
      });
      if (!granted) {
        setLastError('Search-provider access was not granted.');
        return;
      }
    }

    const updated = await updateRetrievalSettings({
      ...retrievalSettings,
      webSearchEnabled,
      webSearchEndpoint: endpoint.origin + endpoint.pathname.replace(/\/$/, ''),
    });
    if (updated && !webSearchEnabled) {
      await chrome.permissions.remove({ origins: [originPattern] });
    }
  };

  const handleSaveWebSearchEndpoint = async () => {
    let endpoint: URL;
    try {
      endpoint = new URL(webSearchEndpoint.trim());
      if (endpoint.protocol !== 'https:') throw new Error('HTTPS required');
    } catch {
      setLastError('Enter a valid HTTPS SearXNG endpoint.');
      return;
    }
    const granted = await chrome.permissions.request({
      origins: [`${endpoint.origin}/*`],
    });
    if (!granted) {
      setLastError('Search-provider access was not granted.');
      return;
    }
    const normalized = endpoint.origin + endpoint.pathname.replace(/\/$/, '');
    const previousEndpoint = retrievalSettings.webSearchEndpoint;
    setWebSearchEndpoint(normalized);
    const updated = await updateRetrievalSettings({
      ...retrievalSettings,
      webSearchEndpoint: normalized,
    });
    if (updated && previousEndpoint && previousEndpoint !== normalized) {
      try {
        const previousOrigin = new URL(previousEndpoint).origin;
        if (previousOrigin !== endpoint.origin) {
          await chrome.permissions.remove({ origins: [`${previousOrigin}/*`] });
        }
      } catch {
        // Invalid legacy endpoint has no permission pattern to remove.
      }
    }
  };

  const handleRefreshRetrieval = async () => {
    setRetrievalBusy(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REFRESH_RETRIEVAL',
      }) as { ok?: boolean; error?: string; diagnostics?: RetrievalDiagnostics };
      if (!response?.ok) {
        setLastError(response?.error ?? 'Unable to refresh retrieval.');
        return;
      }
      if (response.diagnostics) setRetrievalDiagnostics(response.diagnostics);
      setLastError(null);
    } finally {
      setRetrievalBusy(false);
    }
  };

  const handleOpenOptions = async () => {
    try {
      await chrome.runtime.openOptionsPage();
      setLastError(null);
    } catch {
      try {
        await chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
        setLastError(null);
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'Unable to open options.');
      }
    }
  };

  const modeOptions = ['Work', 'Learning', 'Relax'];

  if (!disclosureAccepted) {
    return (
      <main style={{ minWidth: 300, maxWidth: 360, padding: 16, fontFamily: 'sans-serif' }}>
        <h2 style={{ marginTop: 0 }}>Before MyAlgo observes YouTube</h2>
        <p><strong>Disclosure v{PRIVACY_DISCLOSURE_VERSION}</strong></p>
        <p>MyAlgo observes {PRIVACY_DISCLOSURE.pages.toLowerCase()}.</p>
        <p>It records {PRIVACY_DISCLOSURE.data} to {PRIVACY_DISCLOSURE.purpose}.</p>
        <p>{PRIVACY_DISCLOSURE.storage}. {PRIVACY_DISCLOSURE.transfer}.</p>
        <p>{PRIVACY_DISCLOSURE.deletion}.</p>
        <button type="button" onClick={() => void handleAcceptDisclosure()}>Accept and enable MyAlgo</button>
        <button type="button" onClick={() => void handleOpenOptions()} style={{ marginLeft: 8 }}>Review settings</button>
        {lastError ? <p style={{ color: '#b91c1c' }}>{lastError}</p> : null}
      </main>
    );
  }

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
        <label><input type="checkbox" checked={!sourceFilters.includePlayables} onChange={(event) => void handleFilterChange('includePlayables', !event.target.checked)} /> Hide Playables</label>
      </fieldset>
      <fieldset>
        <legend>Candidate discovery</legend>
        <label>
          <input
            type="checkbox"
            checked={retrievalSettings.rssEnabled}
            disabled={retrievalBusy}
            onChange={(event) => void handleRetrievalChange(event.target.checked)}
          /> Enable RSS discovery
        </label>
        <p style={{ margin: '6px 0', maxWidth: 280, fontSize: 12 }}>
          Uses recently observed YouTube channel IDs to fetch bounded YouTube RSS updates. Retrieved items are candidates only; retrieval is not preference evidence.
        </p>
        <button
          type="button"
          disabled={(!retrievalSettings.rssEnabled && !retrievalSettings.webSearchEnabled) || retrievalBusy}
          onClick={() => void handleRefreshRetrieval()}
        >
          {retrievalBusy ? 'Refreshing…' : 'Refresh discovery'}
        </button>
        <p style={{ margin: '6px 0 0', fontSize: 12 }}>
          RSS: {retrievalDiagnostics.rssCandidatesAdded} added · {retrievalDiagnostics.rssCandidatesDeduplicated} deduplicated · {retrievalDiagnostics.rssFeedsSucceeded}/{retrievalDiagnostics.rssChannelsConsidered} feeds succeeded
        </p>
        {retrievalDiagnostics.lastError ? (
          <p role="status" style={{ margin: '6px 0 0', maxWidth: 280, fontSize: 12 }}>
            {retrievalDiagnostics.lastError}
          </p>
        ) : null}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #e5e7eb' }}>
          <label htmlFor="web-search-endpoint" style={{ display: 'block', fontWeight: 600 }}>SearXNG search endpoint</label>
          <input
            id="web-search-endpoint"
            type="url"
            placeholder="https://search.example.org"
            value={webSearchEndpoint}
            disabled={retrievalBusy}
            onChange={(event) => setWebSearchEndpoint(event.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, padding: 6 }}
          />
          <button
            type="button"
            disabled={retrievalBusy || !webSearchEndpoint.trim()}
            onClick={() => void handleSaveWebSearchEndpoint()}
            style={{ marginTop: 6 }}
          >
            Save search endpoint
          </button>
          <label style={{ display: 'block', marginTop: 8 }}>
            <input
              type="checkbox"
              checked={retrievalSettings.webSearchEnabled === true}
              disabled={retrievalBusy}
              onChange={(event) => void handleWebSearchChange(event.target.checked)}
            /> Enable graph + mode web search
          </label>
          <p style={{ margin: '6px 0', maxWidth: 280, fontSize: 12 }}>
            Sends only bounded graph-derived goal/topic queries plus the active mode intent to the configured SearXNG endpoint. Search results are discovery candidates, then YouTube metadata is enriched locally before scoring.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12 }}>
            Search: {retrievalDiagnostics.webSearchCandidatesAdded ?? 0} added · {retrievalDiagnostics.webSearchCandidatesDeduplicated ?? 0} deduplicated · {retrievalDiagnostics.webSearchPlansSucceeded ?? 0}/{retrievalDiagnostics.webSearchPlansAttempted ?? 0} plans succeeded
          </p>
        </div>
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
      <button onClick={() => void handleOpenOptions()} style={{ marginTop: 12 }}>
        Open options
      </button>
    </main>
  );
}
