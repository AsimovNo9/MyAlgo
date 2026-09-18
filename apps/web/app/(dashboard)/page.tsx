import type { FeedResponse } from '@repo/shared-types';
import { AuthPanel } from '@/components/AuthPanel';

const fallbackFeed: FeedResponse = {
  generatedAt: new Date().toISOString(),
  items: [
    { id: '1', external_id: 'abc123', title: 'AI agents workflow demo', channel_name: 'Build with AI', score: 92, visible: true },
    { id: '2', external_id: 'def456', title: 'Productivity system overview', channel_name: 'Deep Work Daily', score: 80, visible: true },
  ],
};

export default function DashboardPage() {
  return (
    <main style={{ display: 'grid', gap: 20, padding: 24 }}>
      <h1>Personal Algorithm</h1>
      <p>Feed preview and scoring summary.</p>
      <AuthPanel />
      <section style={{ background: 'white', borderRadius: 12, padding: 16, border: '1px solid #d1d5db' }}>
        <h2>Ranked feed</h2>
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
