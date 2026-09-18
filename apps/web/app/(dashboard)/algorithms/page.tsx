'use client';

import { useEffect, useState } from 'react';
import type { Algorithm, AlgorithmPayload } from '@repo/shared-types';

const emptyPayload: Omit<AlgorithmPayload, 'id'> = {
  name: 'Work',
  is_active: true,
  goal_text: 'Learn AI agents and shipping decisions.',
  topic_weights: [
    { topic: 'AI', weight: 90 },
    { topic: 'Productivity', weight: 75 },
    { topic: 'Business', weight: 60 },
  ],
  rules: [
    { id: 'seed-rule-1', type: 'always_show', condition_text: 'AI agent tutorials' },
    { id: 'seed-rule-2', type: 'never_show', condition_text: 'celebrity gossip' },
  ],
};

export default function AlgorithmsPage() {
  const [algorithms, setAlgorithms] = useState<Algorithm[]>([]);
  const [form, setForm] = useState(emptyPayload);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchAlgorithms();
  }, []);

  const fetchAlgorithms = async () => {
    const response = await fetch('/api/algorithms');
    if (!response.ok) return;

    const data = (await response.json()) as Algorithm[];
    setAlgorithms(data);
  };

  const handleCreate = async () => {
    setSaving(true);

    try {
      const response = await fetch('/api/algorithms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (response.ok) {
        setForm(emptyPayload);
        await fetchAlgorithms();
      }
    } finally {
      setSaving(false);
    }
  };

  const activeAlgorithm = algorithms.find((algorithm) => algorithm.is_active) ?? algorithms[0];

  return (
    <main style={{ display: 'grid', gap: 20, padding: 24 }}>
      <h1>Algorithms</h1>

      <section style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #d1d5db' }}>
        <h2>Create algorithm</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Algorithm name"
            style={{ padding: 8 }}
          />
          <textarea
            value={form.goal_text ?? ''}
            onChange={(event) => setForm((current) => ({ ...current, goal_text: event.target.value || null }))}
            placeholder="Goal / mission"
            rows={3}
            style={{ padding: 8 }}
          />
          <button onClick={() => void handleCreate()} disabled={saving}>
            {saving ? 'Saving…' : 'Create algorithm'}
          </button>
        </div>
      </section>

      <section style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #d1d5db' }}>
        <h2>Saved algorithms</h2>
        {activeAlgorithm ? <p>Active mode: {activeAlgorithm.name}</p> : <p>No algorithms yet.</p>}
        <ul>
          {algorithms.map((algorithm) => (
            <li key={algorithm.id ?? algorithm.name} style={{ marginBottom: 12 }}>
              <strong>{algorithm.name}</strong>
              {algorithm.goal_text ? <div>{algorithm.goal_text}</div> : null}
              <div>
                {algorithm.topic_weights?.map((item) => (
                  <span key={`${algorithm.id ?? algorithm.name}-${item.topic}`} style={{ marginRight: 8 }}>
                    {item.topic}: {item.weight}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
