import React from 'react';
import { buildDurableModeOptions, summarizeFeed, type FeedSummary } from '../lib/extension-helpers';
import type { DurableSemanticModeCatalog, FeedItem, FeedSourceFilters, RetrievalSettings } from '@repo/shared-types';
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



const emptyFeedSummary: FeedSummary = { subscribedCount: 0, discoveredCount: 0, topTopics: [], categories: [] };

type ToggleChipProps = {
  active: boolean;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
};

function ToggleChip({ active, label, disabled = false, onToggle }: ToggleChipProps) {
  return (
    <button
      type="button"
      className="myalgo-toggle-chip"
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="myalgo-toggle-chip-dot" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

export function Popup() {
  const [mode, setMode] = React.useState('Default');
  const [activeModeId, setActiveModeId] = React.useState('default');
  const [selectedModeIds, setSelectedModeIds] = React.useState<string[]>([]);
  const [modeSearch, setModeSearch] = React.useState('');
  const [durableModeCatalog, setDurableModeCatalog] = React.useState<DurableSemanticModeCatalog | null>(null);
  const [feedReplacementPercent, setFeedReplacementPercent] = React.useState(0);
  const [feedCount, setFeedCount] = React.useState(0);
  const [lastError, setLastError] = React.useState<string | null>(null);
  const [enabled, setEnabled] = React.useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = React.useState(false);
  const [sourceFilters, setSourceFilters] = React.useState<FeedSourceFilters>(defaultSourceFilters);
  const [retrievalSettings, setRetrievalSettings] = React.useState<RetrievalSettings>(defaultRetrievalSettings);
  const [retrievalBusy, setRetrievalBusy] = React.useState(false);
  const [feedSummary, setFeedSummary] = React.useState<FeedSummary>(emptyFeedSummary);

  React.useEffect(() => {
    chrome.storage.local.get(['personal-algorithm-mode', 'personal-algorithm-active-mode-id', 'personal-algorithm-active-mode-ids', 'personal-algorithm-durable-mode-catalog', 'personal-algorithm-feed-replacement-percent', 'personal-algorithm-feed-cache', 'personal-algorithm-enabled', 'personal-algorithm-source-filters', 'personal-algorithm-retrieval-settings', 'personal-algorithm-last-error', 'personal-algorithm-privacy-disclosure-accepted-version']).then((result) => {
      const storedMode = (result['personal-algorithm-mode'] as string) ?? 'Default';
      const catalog = (result['personal-algorithm-durable-mode-catalog'] as DurableSemanticModeCatalog | undefined) ?? null;
      const storedModeId = (result['personal-algorithm-active-mode-id'] as string | undefined)
        ?? catalog?.modes.find((entry) => entry.label.toLowerCase() === storedMode.toLowerCase())?.id
        ?? (storedMode.toLowerCase() === 'default' ? 'default' : storedMode);
      setMode(storedMode);
      setActiveModeId(storedModeId);
      const storedModeIds = result['personal-algorithm-active-mode-ids'] as string[] | undefined;
      setSelectedModeIds(Array.isArray(storedModeIds)
        ? storedModeIds
        : storedModeId !== 'default' ? [storedModeId] : []);
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
      setLastError(result['personal-algorithm-last-error'] as string | null);
    });
  }, []);

  const handleSetMode = async (nextModeId: string) => {
    const response = await chrome.runtime.sendMessage({
      type: 'SET_MODE',
      payload: { modeId: nextModeId, toggle: nextModeId !== 'default' },
    }) as { ok?: boolean; error?: string; mode?: string; modeId?: string; modeIds?: string[] };
    if (!response?.ok) {
      setLastError(response?.error ?? 'Unable to change mode.');
      return;
    }
    setActiveModeId(response.modeId ?? 'default');
    setSelectedModeIds(response.modeIds ?? []);
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
      }) as { ok?: boolean; error?: string };
      if (!response?.ok) {
        setRetrievalSettings(previousSettings);
        setLastError(response?.error ?? 'Unable to update retrieval settings.');
        return false;
      }
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
  const selectedModeOptions = modeOptions.filter((option) => (
    option.id !== 'default' && selectedModeIds.includes(option.id)
  ));
  const normalizedModeSearch = modeSearch.trim().toLowerCase();
  const searchableModeOptions = modeOptions.filter((option) => (
    option.id !== 'default'
    && (!normalizedModeSearch
      || option.label.toLowerCase().includes(normalizedModeSearch)
      || option.id.toLowerCase().includes(normalizedModeSearch))
  ));

  if (!disclosureAccepted) {
    return (
      <main className="myalgo-popup">
        <div className="myalgo-popup-header">
          <div className="myalgo-brand">My<span>Algo</span></div>
        </div>
        <h2 style={{ marginTop: 0 }}>Before MyAlgo observes YouTube</h2>
        <p><strong>Disclosure v{PRIVACY_DISCLOSURE_VERSION}</strong></p>
        <p>MyAlgo observes {PRIVACY_DISCLOSURE.pages.toLowerCase()}.</p>
        <p>It records {PRIVACY_DISCLOSURE.data} to {PRIVACY_DISCLOSURE.purpose}.</p>
        <p>{PRIVACY_DISCLOSURE.storage}. {PRIVACY_DISCLOSURE.transfer}.</p>
        <p>{PRIVACY_DISCLOSURE.deletion}.</p>
        <button type="button" onClick={() => void handleAcceptDisclosure()}>Accept and enable MyAlgo</button>
        <button type="button" onClick={() => void handleOpenOptions()} style={{ marginLeft: 8 }}>Review settings</button>
        {lastError ? <p className="myalgo-popup-error">{lastError}</p> : null}
      </main>
    );
  }

  return (
    <main className="myalgo-popup">
      <div className="myalgo-popup-header">
        <div>
          <div className="myalgo-brand">My<span>Algo</span></div>
          <div style={{ marginTop: 2, color: '#c5d2e3', fontSize: 11 }}>Tune what shapes your YouTube feed</div>
        </div>
      </div>
      <div className="myalgo-popup-status" style={{
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
      <section>
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4, color: '#f8fbff' }}>Your interests</div>
        <div style={{ fontSize: 12, color: '#c5d2e3' }}>
          {selectedModeIds.length === 0 ? 'All interests can influence the feed' : <><strong>{mode}</strong> currently shapes the feed</>}
        </div>
      </section>
      <p style={{ marginTop: -6, fontSize: 12 }}>
        {durableModeCatalog?.modes.filter((entry) => entry.active).length ?? 0} active interests
        {' · '}{feedCount} ready videos
      </p>
      <p>Feed sources: <strong>{feedSummary.subscribedCount} from subscriptions</strong> · <strong>{feedSummary.discoveredCount} found by MyAlgo</strong></p>
      <fieldset>
        <legend>Feed mix</legend>
        <label htmlFor="feed-replacement-percent">Use MyAlgo for <strong>{feedReplacementPercent}%</strong> of eligible Home slots</label>
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
            ? '0 keeps YouTube as-is. Higher values let MyAlgo replace more eligible cards when it has a good match.'
            : 'Higher values ask MyAlgo to show more from your selected interests. If it cannot find a good match, the YouTube card stays.'}
        </p>
        <div className="myalgo-toggle-row" aria-label="Feed filters">
          <ToggleChip
            active={sourceFilters.subscribedOnly}
            label="Subscriptions only"
            onToggle={() => void handleFilterChange('subscribedOnly', !sourceFilters.subscribedOnly)}
          />
          <ToggleChip
            active={!sourceFilters.includeDiscovery}
            label="Hide MyAlgo finds"
            onToggle={() => void handleFilterChange('includeDiscovery', sourceFilters.includeDiscovery ? false : true)}
          />
          <ToggleChip
            active={!sourceFilters.includeShorts}
            label="Hide Shorts"
            onToggle={() => void handleFilterChange('includeShorts', sourceFilters.includeShorts ? false : true)}
          />
          <ToggleChip
            active={!sourceFilters.includeLive}
            label="Hide live"
            onToggle={() => void handleFilterChange('includeLive', sourceFilters.includeLive ? false : true)}
          />
          <ToggleChip
            active={!sourceFilters.includePlayables}
            label="Hide games"
            onToggle={() => void handleFilterChange('includePlayables', sourceFilters.includePlayables ? false : true)}
          />
        </div>
      </fieldset>
      <fieldset>
        <legend>Find new videos</legend>
        <p style={{ margin: '0 0 10px', fontSize: 12 }}>
          MyAlgo refreshes automatically when YouTube loads and when you change interests.
        </p>
        <div className="myalgo-toggle-row" aria-label="Automatic discovery sources">
          <ToggleChip
            active={retrievalSettings.rssEnabled}
            label="Channels you watch"
            disabled={retrievalBusy}
            onToggle={() => void handleRetrievalChange(!retrievalSettings.rssEnabled)}
          />
          <ToggleChip
            active={retrievalSettings.webSearchEnabled === true}
            label="YouTube search"
            disabled={retrievalBusy}
            onToggle={() => void handleWebSearchChange(retrievalSettings.webSearchEnabled !== true)}
          />
        </div>
      </fieldset>
      {lastError ? <p className="myalgo-popup-error">Something went wrong: {lastError}</p> : null}
      <div className="myalgo-popup-actions">
        <button onClick={() => void handleToggleEnabled()}>{enabled ? 'Pause MyAlgo' : 'Turn on MyAlgo'}</button>
      </div>
      <section style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Interests used for this feed</div>
        <div className="myalgo-chip-row">
          <button
            type="button"
            onClick={() => void handleSetMode('default')}
            aria-pressed={selectedModeIds.length === 0}
            className="myalgo-interest-chip"
          >
            All
          </button>
          {selectedModeOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => void handleSetMode(option.id)}
              aria-pressed="true"
              title="Click to stop using"
              className="myalgo-interest-chip"
            >
              {option.label}{option.active ? '' : ' · retained'}
            </button>
          ))}
        </div>
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
            Browse interests ({Math.max(0, modeOptions.length - 1)})
          </summary>
          <input
            type="search"
            value={modeSearch}
            onChange={(event) => setModeSearch(event.target.value)}
            placeholder="Search interests"
            aria-label="Search interests"
            className="myalgo-interest-search"
          />
          <div className="myalgo-chip-row myalgo-chip-row--interests">
            {searchableModeOptions.map((option) => {
              const pressed = selectedModeIds.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => void handleSetMode(option.id)}
                  aria-pressed={pressed}
                  className="myalgo-interest-chip"
                >
                  {option.label}{option.active ? '' : ' (retained)'}
                </button>
              );
            })}
            {searchableModeOptions.length === 0 ? (
              <span style={{ fontSize: 12, color: '#b9c9dc' }}>No matching interests.</span>
            ) : null}
          </div>
        </details>
      </section>
      <button className="myalgo-popup-primary" onClick={() => void handleOpenOptions()}>
        Open MyAlgo settings
      </button>
    </main>
  );
}
