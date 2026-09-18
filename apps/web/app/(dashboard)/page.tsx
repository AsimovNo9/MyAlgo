'use client';

import { useState } from 'react';
import type { Algorithm, FeedResponse } from '@repo/shared-types';
import { AuthPanel } from '@/components/AuthPanel';
import { buildFeedResponse } from '@/lib/feed';

const activeAlgorithm: Algorithm = {
  id: 'demo-algorithm',
  name: 'Work',
  is_active: true,
  goal_text: 'Learn AI agents and shipping decisions.',
  topic_weights: [
    { topic: 'AI', weight: 90 },
    { topic: 'Productivity', weight: 75 },
    { topic: 'Business', weight: 60 },
  ],
  rules: [
    { id: 'rule-demo-1', type: 'always_show', condition_text: 'AI agent tutorials' },
    { id: 'rule-demo-2', type: 'never_show', condition_text: 'celebrity gossip' },
  ],
};

const fallbackFeed: FeedResponse = buildFeedResponse(activeAlgorithm);

export default function DashboardPage() {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ ok?: boolean; source?: string; synced?: number; classified?: number; error?: string } | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus(null);

    try {
      const response = await fetch('/api/youtube/sync', { method: 'POST', credentials: 'include' });
      const data = (await response.json()) as { ok?: boolean; source?: string; synced?: number; classified?: number; error?: string };
      setSyncStatus(data);
    } catch (error) {
      setSyncStatus({ ok: false, error: error instanceof Error ? error.message : 'Unknown sync error' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main style={{ display: 'grid', gap: 20, padding: 24 }}>
      <h1>Personal Algorithm</h1>
      <p>Feed preview and scoring summary.</p>
      <AuthPanel />
      <section style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #d1d5db' }}>
        <h2>Active algorithm: {activeAlgorithm.name}</h2>
        <p>Goal: {activeAlgorithm.goal_text}</p>
      </section>
      <section style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #d1d5db' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Ranked feed</h2>
          <button onClick={() => void handleSync()} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync subscriptions'}
          </button>
        </div>

        {syncStatus ? (
          <p style={{ marginBottom: 12 }}>
            {syncStatus.ok
              ? `Synced ${syncStatus.synced ?? 0} items and classified ${syncStatus.classified ?? 0} from ${syncStatus.source ?? 'fixture'} data.`
              : `Sync failed: ${syncStatus.error ?? 'Unknown error'}`}
          </p>
        ) : null}

        <ul>
          {fallbackFeed.items.map((item) => (
            <li key={item.id}>
              {item.title} — {item.channel_name} — score {item.score}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
