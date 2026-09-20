import type { FeedActivitySignal } from './feed.ts';
import { createSupabaseServerClient } from './supabase/server';

export async function fetchActivitySignalsForUser(userId: string): Promise<FeedActivitySignal[]> {
  const client = await createSupabaseServerClient();
  if (!client || userId === 'demo-user') return [];

  const { data, error } = await client
    .from('activity_events')
    .select('event_type, watch_seconds, occurred_at, content_items(external_id)')
    .eq('user_id', userId)
    .order('occurred_at', { ascending: false });

  if (error || !data) {
    console.error('Failed to fetch user activity signals', error);
    return [];
  }

  return data
    .map((row): FeedActivitySignal | null => {
      const contentItem = typeof row.content_items === 'object' && row.content_items !== null
        ? row.content_items as { external_id?: string }
        : null;
      const externalId = contentItem?.external_id ? String(contentItem.external_id) : '';
      if (!externalId) return null;
      return {
        external_id: externalId,
        eventType: row.event_type as FeedActivitySignal['eventType'],
        watchSeconds: typeof row.watch_seconds === 'number' ? row.watch_seconds : null,
        occurredAt: typeof row.occurred_at === 'string' ? row.occurred_at : null,
      };
    })
    .filter((signal): signal is FeedActivitySignal => signal !== null);
}