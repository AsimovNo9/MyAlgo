import type { FeedFeedbackSignal } from './feed';
import { createSupabaseServerClient } from './supabase/server';

export async function fetchFeedbackSignalsForUser(userId: string): Promise<FeedFeedbackSignal[]> {
  const client = await createSupabaseServerClient();
  if (!client || userId === 'demo-user') {
    return [];
  }

  const { data, error } = await client
    .from('feedback_events')
    .select('event_type, created_at, content_items(external_id, channel_id)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    console.error('Failed to fetch user feedback signals', error);
    return [];
  }

  return data
    .map((row): FeedFeedbackSignal | null => {
      const contentItem = typeof row.content_items === 'object' && row.content_items !== null
        ? row.content_items as { external_id?: string; channel_id?: string | null }
        : null;
      const externalId = contentItem?.external_id ? String(contentItem.external_id) : '';

      if (!externalId) {
        return null;
      }

      return {
        external_id: externalId,
        channel_id: contentItem?.channel_id ?? null,
        eventType: row.event_type as FeedFeedbackSignal['eventType'],
        createdAt: typeof row.created_at === 'string' ? row.created_at : null,
      };
    })
    .filter((item): item is FeedFeedbackSignal => item !== null);
}
