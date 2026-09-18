'use client';

import { useEffect, useState } from 'react';
import type { Algorithm, Rule } from '@repo/shared-types';

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [algorithms, setAlgorithms] = useState<Algorithm[]>([]);
  const [selectedAlgorithmId, setSelectedAlgorithmId] = useState<string>('');
  const [form, setForm] = useState({ type: 'always_show' as Rule['type'], condition_text: 'AI agent tutorials' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadAlgorithms();
  }, []);

  const loadAlgorithms = async () => {
    const response = await fetch('/api/algorithms');
    if (!response.ok) return;

    const data = (await response.json()) as Algorithm[];
    setAlgorithms(data);

    if (data[0]?.id) {
      setSelectedAlgorithmId(data[0].id);
    }

    const rulesResponse = await fetch('/api/rules');
    if (!rulesResponse.ok) return;

    const rulesData = (await rulesResponse.json()) as Rule[];
    setRules(rulesData);
  };

  const handleCreateRule = async () => {
    if (!selectedAlgorithmId) return;

    setSaving(true);

    try {
      const response = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          algorithmId: selectedAlgorithmId,
          type: form.type,
          condition_text: form.condition_text,
        }),
      });

      if (response.ok) {
        const nextRules = await fetch('/api/rules');
        if (nextRules.ok) {
          setRules((await nextRules.json()) as Rule[]);
        }
        setForm({ type: 'always_show', condition_text: 'AI agent tutorials' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <main style={{ display: 'grid', gap: 20, padding: 24 }}>
      <h1>Rules</h1>

      <section style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #d1d5db' }}>
        <h2>Create rule</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <select value={selectedAlgorithmId} onChange={(event) => setSelectedAlgorithmId(event.target.value)}>
            {algorithms.map((algorithm) => (
              <option key={algorithm.id ?? algorithm.name} value={algorithm.id ?? ''}>
                {algorithm.name}
              </option>
            ))}
          </select>

          <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as Rule['type'] }))}>
            <option value="always_show">Always show</option>
            <option value="never_show">Never show</option>
            <option value="priority">Priority</option>
          </select>

          <textarea
            value={form.condition_text}
            onChange={(event) => setForm((current) => ({ ...current, condition_text: event.target.value }))}
            rows={3}
            style={{ padding: 8 }}
          />

          <button onClick={() => void handleCreateRule()} disabled={saving || !selectedAlgorithmId}>
            {saving ? 'Saving…' : 'Create rule'}
          </button>
        </div>
      </section>

      <section style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #d1d5db' }}>
        <h2>Current rules</h2>
        <ul>
          {rules.map((rule) => (
            <li key={rule.id ?? `${rule.type}-${rule.condition_text}`}>
              {rule.type}: {rule.condition_text}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
