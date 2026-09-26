import React from 'react';
import type { RetrievalSettings } from '@repo/shared-types';
import { PRIVACY_DISCLOSURE, PRIVACY_DISCLOSURE_VERSION, isPrivacyDisclosureAccepted } from '../lib/privacy';
import { STORAGE_KEYS } from '../lib/storage';

export function Options() {
  const [mode, setMode] = React.useState('Work');
  const [historyObservationEnabled, setHistoryObservationEnabled] = React.useState(false);
  const [homeObservationEnabled, setHomeObservationEnabled] = React.useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = React.useState(false);
  const [searchProvider, setSearchProvider] = React.useState<'privau' | 'custom_searxng'>('privau');
  const [searchEndpoint, setSearchEndpoint] = React.useState('https://priv.au');
  const [searchApiKey, setSearchApiKey] = React.useState('');
  const [status, setStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    chrome.storage.local.get([
      'personal-algorithm-mode',
      'personal-algorithm-history-observation-enabled',
      'personal-algorithm-home-observation-enabled',
      'personal-algorithm-privacy-disclosure-accepted-version',
      STORAGE_KEYS.RETRIEVAL_SETTINGS,
      STORAGE_KEYS.WEB_SEARCH_API_KEY,
    ]).then((result) => {
      setMode((result['personal-algorithm-mode'] as string) ?? 'Work');
      setHistoryObservationEnabled(result['personal-algorithm-history-observation-enabled'] === true);
      setHomeObservationEnabled(result['personal-algorithm-home-observation-enabled'] === true);
      setDisclosureAccepted(isPrivacyDisclosureAccepted(result['personal-algorithm-privacy-disclosure-accepted-version']));
      const retrievalSettings = (result[STORAGE_KEYS.RETRIEVAL_SETTINGS] as RetrievalSettings | undefined) ?? { rssEnabled: false };
      const provider = retrievalSettings.webSearchProvider ?? 'privau';
      setSearchProvider(provider);
      setSearchEndpoint(provider === 'privau'
        ? 'https://priv.au'
        : retrievalSettings.webSearchEndpoint ?? '');
      setSearchApiKey(String(result[STORAGE_KEYS.WEB_SEARCH_API_KEY] ?? ''));
    });
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

  const handleSaveSearchSettings = async () => {
    const endpointValue = searchProvider === 'privau' ? 'https://priv.au' : searchEndpoint.trim();
    let endpoint: URL;
    try {
      endpoint = new URL(endpointValue);
      if (endpoint.protocol !== 'https:') throw new Error('HTTPS required');
    } catch {
      setStatus('Search endpoint must be a valid HTTPS URL.');
      return;
    }

    if (searchProvider === 'privau' && !searchApiKey.trim()) {
      setStatus('PrivAU requires an API key. Request one from priv.au/api, then paste it here.');
      return;
    }

    const current = await chrome.storage.local.get([STORAGE_KEYS.RETRIEVAL_SETTINGS]);
    const previous = (current[STORAGE_KEYS.RETRIEVAL_SETTINGS] as RetrievalSettings | undefined) ?? {
      rssEnabled: false,
      webSearchEnabled: false,
      webSearchEndpoint: 'https://priv.au',
      webSearchProvider: 'privau',
    };

    const originPattern = `${endpoint.origin}/*`;
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) {
      setStatus('Search-provider host access was not granted.');
      return;
    }

    const normalizedEndpoint = endpoint.origin + endpoint.pathname.replace(/\/$/, '');
    await chrome.storage.local.set({
      [STORAGE_KEYS.WEB_SEARCH_API_KEY]: searchApiKey.trim(),
    });

    const response = await chrome.runtime.sendMessage({
      type: 'SET_RETRIEVAL_SETTINGS',
      payload: {
        retrievalSettings: {
          ...previous,
          webSearchEndpoint: normalizedEndpoint,
          webSearchProvider: searchProvider,
        },
      },
    }) as { ok?: boolean; error?: string };

    if (!response?.ok) {
      setStatus(response?.error ?? 'Unable to save search settings.');
      return;
    }

    const previousEndpointValue = previous.webSearchProvider === 'privau'
      ? 'https://priv.au'
      : previous.webSearchEndpoint;
    if (previousEndpointValue) {
      try {
        const previousOrigin = new URL(previousEndpointValue).origin;
        if (previousOrigin !== endpoint.origin) {
          await chrome.permissions.remove({ origins: [`${previousOrigin}/*`] });
        }
      } catch {
        // Invalid legacy endpoint has no permission to clean up.
      }
    }

    setSearchEndpoint(normalizedEndpoint);
    setStatus(searchProvider === 'privau'
      ? 'PrivAU search settings saved.'
      : 'Custom SearXNG search settings saved.');
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
        <h2 style={{ marginTop: 0 }}>Advanced search settings</h2>
        <p>Web discovery runs automatically from your Personal Algorithm Graph goal/topics plus the active mode. There is no manual search box.</p>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Provider
          <select
            value={searchProvider}
            onChange={(event) => {
              const provider = event.target.value as 'privau' | 'custom_searxng';
              setSearchProvider(provider);
              if (provider === 'privau') setSearchEndpoint('https://priv.au');
            }}
            style={{ display: 'block', marginTop: 4, padding: 8, minWidth: 260 }}
          >
            <option value="privau">PrivAU (default)</option>
            <option value="custom_searxng">Custom SearXNG</option>
          </select>
        </label>

        {searchProvider === 'privau' ? (
          <>
            <p>Provider: <strong>https://priv.au</strong></p>
            <label style={{ display: 'block' }}>
              PrivAU API key
              <input
                type="password"
                autoComplete="off"
                value={searchApiKey}
                onChange={(event) => setSearchApiKey(event.target.value)}
                placeholder="API key"
                style={{ display: 'block', width: '100%', maxWidth: 420, boxSizing: 'border-box', marginTop: 4, padding: 8 }}
              />
            </label>
            <p style={{ maxWidth: 620 }}>
              PrivAU requires an API key for JSON search. Request one from <a href="https://priv.au/api" target="_blank" rel="noreferrer">priv.au/api</a>. The key is stored only in this extension's local browser storage and is sent only to PrivAU as an API authentication header.
            </p>
          </>
        ) : (
          <label style={{ display: 'block' }}>
            SearXNG endpoint
            <input
              type="url"
              value={searchEndpoint}
              onChange={(event) => setSearchEndpoint(event.target.value)}
              placeholder="https://search.example.org"
              style={{ display: 'block', width: '100%', maxWidth: 420, boxSizing: 'border-box', marginTop: 4, padding: 8 }}
            />
          </label>
        )}

        <button type="button" onClick={() => void handleSaveSearchSettings()}>
          Save search settings
        </button>
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
