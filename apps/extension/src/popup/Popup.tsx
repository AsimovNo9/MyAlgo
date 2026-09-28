import React from 'react';
import { buildDurableModeOptions, summarizeFeed, type FeedSummary } from '../lib/extension-helpers';
import type { DurableSemanticModeCatalog, FeedItem, FeedSourceFilters, RetrievalDiagnostics, RetrievalSettings } from '@repo/shared-types';
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
  modeSupply: null,
  lastError: null,
};

const emptyFeedSummary: FeedSummary = { subscribedCount: 0, discoveredCount: 0, topTopics: [], categories: [] };

export function Popup() {
  const [mode, setMode] = React.useState('Default');
  const [activeModeId, setActiveModeId] = React.useState('default');
  const [durableModeCatalog, setDurableModeCatalog] = React.useState<DurableSemanticModeCatalog | null>(null);
  const [feedReplacementPercent, setFeedReplacementPercent] = React.useState(0);
  const [feedCount, setFeedCount] = React.useState(0);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = React.useState(false);
  const [sourceFilters, setSourceFilters] = React.useState<FeedSourceFilters>(defaultSourceFilters);
  const [retrievalSettings, setRetrievalSettings] = React.useState<RetrievalSettings>(defaultRetrievalSettings);
  const [retrievalDiagnostics, setRetrievalDiagnostics] = React.useState<RetrievalDiagnostics>(emptyRetrievalDiagnostics);
  const [retrievalBusy, setRetrievalBusy] = React.useState(false);
  const [feedSummary, setFeedSummary] = React.useState<FeedSummary>(emptyFeedSummary);

  React.useEffect(() => {
    chrome.storage.local.get(['personal-algorithm-mode', 'personal-algorithm-active-mode-id', 'personal-algorithm-durable-mode-catalog', 'personal-algorithm-feed-replacement-percent', 'personal-algorithm-feed-cache', 'personal-algorithm-enabled', 'personal-algorithm-source-filters', 'personal-algorithm-retrieval-settings', 'personal-algorithm-retrieval-diagnostics', 'personal-algorithm-last-error', 'personal-algorithm-privacy-disclosure-accepted-version']).then((result) => {
      const storedMode = (result['personal-algorithm-mode'] as string) ?? 'Default';
      const catalog = (result['personal-algorithm-durable-mode-catalog'] as DurableSemanticModeCatalog | undefined) ?? null;
      const storedModeId = (result['personal-algorithm-active-mode-id'] as string | undefined)
        ?? catalog?.modes.find((entry) => entry.label.toLowerCase() === storedMode.toLowerCase())?.id
        ?? (storedMode.toLowerCase() === 'default' ? 'default' : storedMode);
      setMode(storedMode);
      setActiveModeId(storedModeId);
      setDurableModeCatalog(catalog);
      const storedPercent = Number(result['personal-algorithm-feed-replacement-percent'] ?? 0);
      setFeedReplacementPercent(Number.isFinite(storedPercent) ? Math.max(0, Math.min(100, storedPercent)) : 0);
      const cachedFeed = result['personal-algorithm-feed-cache'] as FeedItem[] | undefined;
      setFeedCount(Array.isArray(cachedFeed) ? cachedFeed.length : 0);
      setFeedSummary(Array.isArray(cachedFeed) ? summarizeFeed(cachedFeed) : emptyFeedSummary);
      setDisclosureAccepted(isPrivacyDisclosureAccepted(result['personal-algorithm-privacy-disclosure-accepted-version']));
      setEnabled(isPrivacyDisclosureAccepted(result['personal-algorithm-privacy-disclosure-accepted-version']) && result['personal-algorithm-enabled'] !== false);
      setSourceFilters({ ...defaultSourceFilters, ...(result['personal-algorithm-source-filters'] as FeedSourceFilters | undefined) });
      const nextRetrievalSettings = { ...defaultRetrievalSettings, ...(result['personal-algorithm-retrieval-settings'] as RetrievalSettings | undefined) };
      setRetrievalSettings(nextRetrievalSettings);
      setRetrievalDiagnostics({ ...emptyRetrievalDiagnostics, ...(result['personal-algorithm-retrieval-diagnostics'] as RetrievalDiagnostics | undefined) });
      setLastError(result['personal-algorithm-last-error'] as string | null);
    });
  }, []);

  const handleSetMode = async (nextModeId: string) => {
    const response = await chrome.runtime.sendMessage({
      type: 'SET_MODE',
      payload: { modeId: nextModeId },
    }) as { ok?: boolean; error?: string; mode?: string; modeId?: string };
    if (!response?.ok) {
      setLastError(response?.error ?? 'Unable to change mode.');
      return;
    }
    setActiveModeId(response.modeId ?? nextModeId);
    setMode(response.mode ?? 'Default');
    const result = await chrome.storage.local.get([
      'personal-algorithm-feed-cache',
      'personal-algorithm-durable-mode-catalog',
    ]);
    const cachedFeed = result['personal-algorithm-feed-cache'] as FeedItem[] | undefined;
    setFeedCount(Array.isArray(cachedFeed) ? cachedFeed.length : 0);
    setFeedSummary(Array.isArray(cachedFeed) ? summarizeFeed(cachedFeed) : emptyFeedSummary);
    setDurableModeCatalog(
      (result['personal-algorithm-durable-mode-catalog'] as DurableSemanticModeCatalog | undefined) ?? null,
    );
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

  const handleReplacementChange = async (percent: number) => {
    setFeedReplacementPercent(percent);
    const response = await chrome.runtime.sendMessage({
      type: 'SET_FEED_REPLACEMENT_PERCENT',
      payload: { feedReplacementPercent: percent },
    }) as { ok?: boolean; error?: string };
    if (!response?.ok) setLastError(response?.error ?? 'Unable to update the feed mix.');
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
    await updateRetrievalSettings({
      ...retrievalSettings,
      webSearchEnabled,
    });
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

  const modeOptions = buildDurableModeOptions(activeModeId, durableModeCatalog, mode);

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
      <p>Current mode: <strong>{mode === 'Default' ? 'All' : mode}</strong></p>
      <p style={{ marginTop: -6, fontSize: 12 }}>
        {durableModeCatalog?.modes.filter((entry) => entry.active).length ?? 0} durable inferred modes · graph revision {durableModeCatalog?.graphRevision ?? '—'}
      </p>
      <p>Status: <strong>{enabled ? 'Active' : 'Paused'}</strong></p>
      <p>Cached feed items: <strong>{feedCount}</strong></p>
      <p>Feed mix: <strong>{feedSummary.subscribedCount} subscribed</strong> · <strong>{feedSummary.discoveredCount} discovered</strong></p>
      {feedSummary.topTopics.length > 0 ? (
        <p>Top topics: {feedSummary.topTopics.map((entry) => `${entry.topic} (${entry.count})`).join(', ')}</p>
      ) : null}
      {feedSummary.categories.length > 0 ? (
        <p>Inferred video categories: {feedSummary.categories.map((entry) => `${entry.category} (${entry.count})`).join(', ')}</p>
      ) : null}
      <fieldset>
        <legend>Feed controls</legend>
        <label htmlFor="feed-replacement-percent">MyAlgo feed replacement: <strong>{feedReplacementPercent}%</strong></label>
        <input
          id="feed-replacement-percent"
          type="range"
          min="0"
          max="100"
          step="10"
          value={feedReplacementPercent}
          style={{ display: 'block', width: '100%' }}
          onChange={(event) => setFeedReplacementPercent(Number(event.target.value))}
          onPointerUp={(event) => void handleReplacementChange(Number(event.currentTarget.value))}
          onKeyUp={(event) => void handleReplacementChange(Number(event.currentTarget.value))}
          onBlur={(event) => void handleReplacementChange(Number(event.currentTarget.value))}
        />
        <p style={{ margin: '4px 0 10px', fontSize: 12 }}>
          {activeModeId === 'default'
            ? '0 keeps native recommendations; 100 tries to fill every safe Home slot from MyAlgo\'s scored pool. Unfilled slots keep their native card.'
            : 'For a durable mode, the slider requests mode coverage across eligible Home slots. Native mode matches count first; any shortfall may be filled only from eligible scored candidates already in MyAlgo\'s acquired pool.'}
        </p>
        {retrievalDiagnostics.modeSupply?.modeId === activeModeId ? (
          <p role="status" style={{ margin: '4px 0 10px', fontSize: 12 }}>
            Mode supply: <strong>{retrievalDiagnostics.modeSupply.nativeModeSupply}/{retrievalDiagnostics.modeSupply.requestedModeSlots} native</strong>
            {' · '}<strong>{retrievalDiagnostics.modeSupply.poolModeSupply} pool</strong>
            {' · '}<strong>{retrievalDiagnostics.modeSupply.fulfilledModeSlots} fulfilled</strong>
            {retrievalDiagnostics.modeSupply.shortfall > 0 ? ' · native shortfall' : ''}
          </p>
        ) : null}
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
          <label style={{ display: 'block', marginTop: 4 }}>
            <input
              type="checkbox"
              checked={retrievalSettings.webSearchEnabled === true}
              disabled={retrievalBusy}
              onChange={(event) => void handleWebSearchChange(event.target.checked)}
            /> Enable web discovery
          </label>
          <p style={{ margin: '6px 0', maxWidth: 280, fontSize: 12 }}>
            MyAlgo automatically searches YouTube from your graph goal/topics plus the active mode; there is no search box. Returned video IDs are passed through the normal YouTube enrichment layer before local scoring.
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
          <button
            key={option.id}
            onClick={() => void handleSetMode(option.id)}
            aria-pressed={option.id === activeModeId}
          >
            {option.label}{option.active ? '' : ' (dormant)'}
          </button>
        ))}
      </div>
      <button onClick={() => void handleOpenOptions()} style={{ marginTop: 12 }}>
        Open options
      </button>
    </main>
  );
}
