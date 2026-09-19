import { NextResponse } from 'next/server';
import { buildFeedResponse, normalizeClassificationRecord, type FeedCandidate, type FeedFeedbackSignal } from '@/lib/feed';
import { listAlgorithms } from '@/lib/data';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';

async function fetchFeedbackSignalsForUser(userId: string): Promise<FeedFeedbackSignal[]> {
  const client = await createSupabaseServerClient();
  if (!client || userId === 'demo-user') {
    return [];
  }

  const { data, error } = await client
    .from('feedback_events')
    .select('event_type, content_items(external_id)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    console.error('Failed to fetch user feedback signals', error);
    return [];
  }

  return data
    .map((row) => {
      const externalId = typeof row.content_items === 'object' && row.content_items !== null && 'external_id' in row.content_items
        ? String((row.content_items as { external_id?: string }).external_id ?? '')
        : '';

      if (!externalId) {
        return null;
      }

      return {
        external_id: externalId,
        eventType: row.event_type as FeedFeedbackSignal['eventType'],
      };
    })
    .filter((item): item is FeedFeedbackSignal => Boolean(item));
}

async function fetchRecentContentForUser(): Promise<FeedCandidate[]> {
  const client = await createSupabaseServerClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from('content_items')
    .select('id, external_id, title, channel_name, channel_id, published_at, classifications(topics, quality_score)')
    .order('fetched_at', { ascending: false })
    .limit(50);

  if (error || !data) {
    console.error('Failed to fetch recent content for ranked feed', error);
    return [];
  }

  return data.map((row) => {
    const classification = normalizeClassificationRecord(row.classifications);
    const baseScore = typeof classification?.quality_score === 'number' ? classification.quality_score : 50;

    return {
      id: row.id,
      external_id: row.external_id,
      title: row.title,
      channel_name: row.channel_name,
      channel_id: row.channel_id,
      published_at: row.published_at,
      base_score: Number.isFinite(baseScore) ? baseScore : 50,
      topics: Array.isArray(classification?.topics) ? classification.topics : [],
    };
  });
}

async function persistFeedCacheForUser(
  userId: string,
  algorithmId: string,
  items: { external_id: string; score: number; visible: boolean }[],
) {
  const client = await createSupabaseServerClient();
  if (!client) {
    return;
  }

  const uniqueExternalIds = [...new Set(items.map((item) => item.external_id).filter(Boolean))];
  if (uniqueExternalIds.length === 0) {
    return;
  }

  const { data: contentRows, error: lookupError } = await client
    .from('content_items')
    .select('id, external_id')
    .in('external_id', uniqueExternalIds);

  if (lookupError) {
    console.error('Failed to resolve content ids for feed cache', lookupError);
    return;
  }

  const itemIdByExternalId = new Map((contentRows ?? []).map((row) => [row.external_id, row.id]));
  const rows = items
    .map((item, index) => {
      const contentItemId = itemIdByExternalId.get(item.external_id);
      if (!contentItemId) {
        return null;
      }

      return {
        user_id: userId,
        algorithm_id: algorithmId,
        content_item_id: contentItemId,
        score: item.score,
        rank: index + 1,
        visible: item.visible,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (rows.length === 0) {
    return;
  }

  const { error: deleteError } = await client
    .from('feed_cache')
    .delete()
    .eq('user_id', userId)
    .eq('algorithm_id', algorithmId);

  if (deleteError) {
    console.error('Failed to clear feed cache before ranking refresh', deleteError);
  }

  const { error: insertError } = await client.from('feed_cache').insert(rows);
  if (insertError) {
    console.error('Failed to persist ranked feed cache', insertError);
  }
}

export async function GET() {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const algorithms = await listAlgorithms(userId);
  const activeAlgorithm = algorithms.find((algorithm) => algorithm.is_active) ?? algorithms[0] ?? null;
  const feedbackSignals = await fetchFeedbackSignalsForUser(userId);
  const liveItems = await fetchRecentContentForUser();
  const response = buildFeedResponse(activeAlgorithm, feedbackSignals, liveItems.length > 0 ? liveItems : undefined);

  if (activeAlgorithm?.id) {
    await persistFeedCacheForUser(userId, activeAlgorithm.id, response.items);
  }

  return NextResponse.json(response);
}
