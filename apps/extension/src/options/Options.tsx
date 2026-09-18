import React from 'react';
import { getApiBaseUrl, setApiBaseUrl } from '../lib/api-client';

const initialWeights = [
  { topic: 'AI', weight: 80 },
  { topic: 'Productivity', weight: 70 },
  { topic: 'Entertainment', weight: 40 },
];

export function Options() {
  const [weights, setWeights] = React.useState(initialWeights);
  const [apiBaseUrl, setApiBaseUrlValue] = React.useState('https://my-algo-web.vercel.app');
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const baseUrl = await getApiBaseUrl();
      setApiBaseUrlValue(baseUrl);
    })();
  }, []);

  const adjustWeight = (topic: string, delta: number) => {
    setWeights((current) =>
      current.map((item) =>
        item.topic === topic ? { ...item, weight: Math.max(0, Math.min(100, item.weight + delta)) } : item,
      ),
    );
  };

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
        <h2>Topic weights</h2>
        {weights.map((item) => (
          <div key={item.topic} style={{ marginBottom: 12 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>{item.topic}</span>
              <strong>{item.weight}</strong>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => adjustWeight(item.topic, -10)}>-10</button>
              <button onClick={() => adjustWeight(item.topic, 10)}>+10</button>
            </div>
          </div>
        ))}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Rules</h2>
        <ul>
          <li>Always show: tutorials about AI agents</li>
          <li>Never show: celebrity gossip</li>
          <li>Priority: engineering breakdowns</li>
        </ul>
      </section>
    </main>
  );
}
