import React from 'react';
import { fetchAlgorithms, getApiBaseUrl, setApiBaseUrl } from '../lib/api-client';
import type { Algorithm } from '@repo/shared-types';

export function Options() {
  const [algorithms, setAlgorithms] = React.useState<Algorithm[]>([]);
  const [selectedAlgorithmName, setSelectedAlgorithmName] = React.useState('');
  const [apiBaseUrl, setApiBaseUrlValue] = React.useState('https://my-algo-web.vercel.app');
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const baseUrl = await getApiBaseUrl();
      setApiBaseUrlValue(baseUrl);
      try {
        const availableAlgorithms = await fetchAlgorithms();
        setAlgorithms(availableAlgorithms);
        setSelectedAlgorithmName(availableAlgorithms[0]?.name ?? '');
      } catch {
        setAlgorithms([]);
      }
    })();
  }, []);

  const handleSaveApiBaseUrl = async () => {
    await setApiBaseUrl(apiBaseUrl);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1>Algorithm settings</h1>

      <section style={{ marginBottom: 24 }}>
        <h2>Web app URL</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={apiBaseUrl}
            onChange={(event) => setApiBaseUrlValue(event.target.value)}
            style={{ flex: 1, padding: 8 }}
          />
          <button onClick={() => void handleSaveApiBaseUrl()}>Save</button>
        </div>
        {saved ? <p style={{ color: 'green' }}>Saved.</p> : null}
      </section>

      <section>
        <h2>Algorithm</h2>
        <select value={selectedAlgorithmName} onChange={(event) => setSelectedAlgorithmName(event.target.value)} style={{ padding: 8, minWidth: 240 }}>
          {algorithms.map((algorithm) => <option key={algorithm.id ?? algorithm.name} value={algorithm.name}>{algorithm.name}</option>)}
        </select>
      </section>

      <section>
        <h2>Topic weights</h2>
        {(algorithms.find((algorithm) => algorithm.name === selectedAlgorithmName)?.topic_weights ?? []).map((item) => (
          <div key={item.topic} style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{item.topic}</span>
              <strong>{item.weight}</strong>
            </label>
          </div>
        ))}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Rules</h2>
        <ul>{(algorithms.find((algorithm) => algorithm.name === selectedAlgorithmName)?.rules ?? []).map((rule) => <li key={`${rule.type}-${rule.condition_text}`}>{rule.type}: {rule.condition_text}</li>)}</ul>
      </section>
    </main>
  );
}
