'use client';

import { useEffect, useState } from 'react';
import type { FeedResponse } from '@repo/shared-types';
import { AuthPanel } from '@/components/AuthPanel';

export function DashboardOverviewPageContent() {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ ok?: boolean; source?: string; synced?: number; classified?: number; error?: string } | null>(null);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);

  useEffect(() => {
    const loadFeed = async () => {
      try {
        const response = await fetch('/api/feed', { credentials: 'include' });
        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => ({}))) as { error?: string };
          setFeedError(errorPayload.error ?? 'Unable to load feed.');
          setFeed(null);
          return;
        }

        const data = (await response.json()) as FeedResponse;
        setFeed(data);
        setFeedError(null);
      } catch (error) {
        setFeedError(error instanceof Error ? error.message : 'Unknown feed error');
        setFeed(null);
      }
    };

    void loadFeed();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus(null);

    try {
      const response = await fetch('/api/youtube/sync', { method: 'POST', credentials: 'include' });
      const data = (await response.json()) as { ok?: boolean; source?: string; synced?: number; classified?: number; error?: string };
      setSyncStatus(data);

      if (data.ok) {
        const refreshed = await fetch('/api/feed', { credentials: 'include' });
        if (refreshed.ok) {
          setFeed((await refreshed.json()) as FeedResponse);
        }
      }
    } catch (error) {
      setSyncStatus({ ok: false, error: error instanceof Error ? error.message : 'Unknown sync error' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <main style={{ display: 'grid', gap: 24 }}>
      <section style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 16,
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        color: 'white',
        borderRadius: 22,
        padding: '22px 24px',
        boxShadow: '0 20px 45px rgba(15, 23, 42, 0.12)',
      }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.72 }}>Dashboard</div>
          <h1 style={{ margin: '8px 0 0', fontSize: 32 }}>Personal Algorithm</h1>
        </div>

        <button onClick={() => void handleSync()} disabled={syncing} style={{
          background: 'linear-gradient(135deg, #8b5cf6, #14b8a6)',
          color: 'white',
          border: 'none',
          boxShadow: '0 12px 30px rgba(139, 92, 246, 0.35)',
        }}>
          {syncing ? 'Syncing…' : 'Sync subscriptions'}
        </button>
      </section>

      <AuthPanel />

      <section style={{
        background: 'rgba(255,255,255,0.74)',
        border: '1px solid rgba(148, 163, 184, 0.18)',
        borderRadius: 24,
        padding: 20,
        boxShadow: '0 20px 50px rgba(15, 23, 42, 0.06)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 24 }}>Ranked feed</h2>
          <div style={{ color: '#475569', fontSize: 13 }}>Live score + explanation</div>
        </div>

        {syncStatus ? (
          <div style={{
            marginBottom: 18,
            padding: '10px 12px',
            borderRadius: 12,
            background: syncStatus.ok ? '#ecfeff' : '#fef2f2',
            border: `1px solid ${syncStatus.ok ? '#a5f3fc' : '#fecaca'}`,
            color: syncStatus.ok ? '#0f172a' : '#7f1d1d',
            fontSize: 14,
          }}>
            {syncStatus.ok
              ? syncStatus.source === 'youtube_api_empty'
                ? 'No live YouTube subscriptions were available to sync.'
                : `Synced ${syncStatus.synced ?? 0} items and classified ${syncStatus.classified ?? 0} from ${syncStatus.source ?? 'live'} data.`
              : `Sync failed: ${syncStatus.error ?? `Live sync unavailable (${syncStatus.source ?? 'unknown source'})`}`}
          </div>
        ) : null}

        {feedError ? (
          <p style={{ margin: 0, color: '#7f1d1d' }}>{feedError}</p>
        ) : feed && feed.items.length > 0 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            {feed.items.map((item) => (
              <article key={item.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 14,
                padding: 18,
                background: 'linear-gradient(180deg, #ffffff, #f8fafc)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: 18,
                boxShadow: '0 10px 30px rgba(15, 23, 42, 0.04)',
              }}>
                <div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 34,
                      height: 34,
                      borderRadius: 10,
                      background: '#eef2ff',
                      color: '#4338ca',
                      fontWeight: 700,
                      fontSize: 13,
                    }}>
                      {item.score}
                    </span>
                    <strong style={{ fontSize: 18 }}>{item.title}</strong>
                    {item.channel_name ? (
                      <span style={{ color: '#64748b', fontSize: 13 }}>• {item.channel_name}</span>
                    ) : null}
                  </div>

                  {item.matched_topics && item.matched_topics.length > 0 ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      {item.matched_topics.map((topic) => (
                        <span key={`${item.id}-${topic}`} style={{
                          background: '#ecfeff',
                          color: '#0f766e',
                          borderRadius: 999,
                          padding: '6px 10px',
                          fontSize: 12,
                          fontWeight: 600,
                        }}>
                          {topic}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {item.reason ? (
                    <div style={{ color: '#334155', fontSize: 13, lineHeight: 1.6 }}>{item.reason}</div>
                  ) : null}
                </div>

                <div style={{
                  minWidth: 110,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#0f172a',
                  color: 'white',
                  borderRadius: 14,
                  padding: '10px 12px',
                  fontWeight: 700,
                  fontSize: 20,
                }}>
                  {item.score}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: '#475569' }}>Sign in to load your ranked YouTube feed.</p>
        )}
      </section>
    </main>
  );
}

export default function DashboardPage() {
  return <DashboardOverviewPageContent />;
}
