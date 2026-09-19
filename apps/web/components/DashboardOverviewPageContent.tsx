'use client';

import { useEffect, useState } from 'react';
import type { FeedResponse } from '@repo/shared-types';
import { AuthPanel } from '@/components/AuthPanel';

export default function DashboardOverviewPageContent() {
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ ok?: boolean; source?: string; synced?: number; discovered?: number; classified?: number; error?: string } | null>(null);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

  const refreshFeed = async () => {
    const response = await fetch('/api/feed', { credentials: 'include' });
    if (!response.ok) {
      throw new Error('Unable to refresh ranked feed.');
    }
    setFeed((await response.json()) as FeedResponse);
  };

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

        setFeed((await response.json()) as FeedResponse);
        setFeedError(null);
      } catch (error) {
        setFeedError(error instanceof Error ? error.message : 'Unknown feed error');
        setFeed(null);
      }
    };

    void loadFeed();
  }, []);

  const handleFeedback = async (contentItemId: string, eventType: 'not_interested' | 'more_like_this' | 'never_show_channel') => {
    setFeedbackPending(`${contentItemId}:${eventType}`);
    setFeedbackNotice(null);

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentItemId, eventType }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to save feedback.');
      }

      await refreshFeed();
      setFeedbackNotice(eventType === 'more_like_this' ? 'We will show you more like this.' : eventType === 'never_show_channel' ? 'This channel will be removed from your feed.' : 'We will show you less like this.');
    } catch (error) {
      setFeedbackNotice(error instanceof Error ? error.message : 'Unable to save feedback.');
    } finally {
      setFeedbackPending(null);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus(null);

    try {
      const response = await fetch('/api/youtube/sync', { method: 'POST', credentials: 'include' });
      const data = (await response.json()) as { ok?: boolean; source?: string; synced?: number; discovered?: number; classified?: number; error?: string };
      setSyncStatus(data);

      if (data.ok) {
        await refreshFeed();
      }
    } catch (error) {
      setSyncStatus({ ok: false, error: error instanceof Error ? error.message : 'Unknown sync error' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <style jsx>{`
        .pageStack { display: grid; gap: 24px; }
        .hero { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
        .feedCard { display: grid; grid-template-columns: 220px minmax(0, 1fr) 68px; align-items: start; gap: 18px; padding: 18px; }
        .feedThumbnail { width: 220px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 12px; background: #e2e8f0; }
        .feedDetails { min-width: 0; }
        .feedTitle { display: block; margin: 0; font-size: 17px; line-height: 1.35; }
        .feedScore { min-height: 68px; display: flex; align-items: center; justify-content: center; background: #0f172a; color: white; border-radius: 14px; font-weight: 700; font-size: 20px; }
        .feedbackActions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
        @media (max-width: 760px) {
          .feedCard { grid-template-columns: minmax(0, 1fr) 58px; gap: 14px; }
          .feedThumbnail { grid-column: 1 / -1; width: min(100%, 320px); max-width: 100%; }
          .feedDetails { grid-column: 1 / -1; }
          .feedScore { grid-column: 2; grid-row: 3; min-height: 52px; }
        }
        @media (max-width: 560px) {
          .hero { align-items: stretch; flex-direction: column; }
          .hero button { width: 100%; }
          .feedCard { padding: 14px; }
          .feedScore { grid-column: 1 / -1; grid-row: auto; width: 100%; min-height: 44px; }
        }
      `}</style>
    <main className="pageStack">
      <section className="hero" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', color: 'white', borderRadius: 22, padding: '22px 24px', boxShadow: '0 20px 45px rgba(15, 23, 42, 0.12)' }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.72 }}>Dashboard</div>
          <h1 style={{ margin: '8px 0 0', fontSize: 32 }}>Personal Algorithm</h1>
        </div>
        <button onClick={() => void handleSync()} disabled={syncing} style={{ background: 'linear-gradient(135deg, #8b5cf6, #14b8a6)', color: 'white', border: 'none', boxShadow: '0 12px 30px rgba(139, 92, 246, 0.35)' }}>
          {syncing ? 'Syncing…' : 'Sync subscriptions'}
        </button>
      </section>

      <AuthPanel />

      <section style={{ background: 'rgba(255,255,255,0.74)', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 24, padding: 20, boxShadow: '0 20px 50px rgba(15, 23, 42, 0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 24 }}>Ranked feed</h2>
          <div style={{ color: '#475569', fontSize: 13 }}>Live score + explanation</div>
        </div>

        {syncStatus ? <div style={{ marginBottom: 18, padding: '10px 12px', borderRadius: 12, background: syncStatus.ok ? '#ecfeff' : '#fef2f2', border: `1px solid ${syncStatus.ok ? '#a5f3fc' : '#fecaca'}`, color: syncStatus.ok ? '#0f172a' : '#7f1d1d', fontSize: 14 }}>
          {syncStatus.ok ? syncStatus.source === 'youtube_api_empty' ? 'No live YouTube subscriptions were available to sync.' : `Synced ${syncStatus.synced ?? 0} items (${syncStatus.discovered ?? 0} discovered) and classified ${syncStatus.classified ?? 0} from ${syncStatus.source ?? 'live'} data.` : `Sync failed: ${syncStatus.error ?? `Live sync unavailable (${syncStatus.source ?? 'unknown source'})`}`}
        </div> : null}

        {feedbackNotice ? <div style={{ marginBottom: 18, color: '#0f766e', fontSize: 14 }}>{feedbackNotice}</div> : null}

        {feedError ? <p style={{ margin: 0, color: '#7f1d1d' }}>{feedError}</p> : feed && feed.items.length > 0 ? <div style={{ display: 'grid', gap: 14 }}>
          {feed.items.map((item) => <article key={item.id} className="feedCard" style={{ background: 'linear-gradient(180deg, #ffffff, #f8fafc)', border: '1px solid rgba(148, 163, 184, 0.25)', borderRadius: 18, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.04)' }}>
            {item.thumbnail_url ? <img className="feedThumbnail" src={item.thumbnail_url} alt="" loading="lazy" /> : <div className="feedThumbnail" />}
            <div className="feedDetails">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <strong className="feedTitle">{item.title}</strong>
                {item.channel_name ? <span style={{ color: '#64748b', fontSize: 13 }}>• {item.channel_name}</span> : null}
              </div>

              {item.matched_topics && item.matched_topics.length > 0 ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {item.matched_topics.map((topic) => <span key={`${item.id}-${topic}`} style={{ background: '#ecfeff', color: '#0f766e', borderRadius: 999, padding: '6px 10px', fontSize: 12, fontWeight: 600 }}>{topic}</span>)}
              </div> : null}

              {item.reason ? <div style={{ color: '#334155', fontSize: 13, lineHeight: 1.6 }}>{item.reason}</div> : null}

              <div className="feedbackActions">
                {([['more_like_this', 'More like this'], ['not_interested', 'Less like this'], ['never_show_channel', 'Hide channel']] as const).map(([eventType, label]) => {
                  const pending = feedbackPending === `${item.external_id}:${eventType}`;
                  return <button key={eventType} type="button" onClick={() => void handleFeedback(item.external_id, eventType)} disabled={feedbackPending !== null} style={{ border: '1px solid rgba(148, 163, 184, 0.35)', background: pending ? '#e0f2fe' : '#f8fafc', color: '#334155', padding: '7px 10px', borderRadius: 10, fontSize: 12, cursor: feedbackPending !== null ? 'wait' : 'pointer' }}>{pending ? 'Saving…' : label}</button>;
                })}
              </div>
            </div>

            <div className="feedScore">{item.score}</div>
          </article>)}
        </div> : <p style={{ margin: 0, color: '#475569' }}>Sign in to load your ranked YouTube feed.</p>}
      </section>
    </main>
    </>
  );
}
