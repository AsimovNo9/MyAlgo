import { NextResponse } from 'next/server';
import { buildFeedResponse, normalizeClassificationRecord, type FeedCandidate } from '@/lib/feed';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchFeedbackSignalsForUser } from '@/lib/feedback-signals';
import { fetchActivitySignalsForUser } from '@/lib/activity-signals';
import type { FeedSourceFilters } from '@repo/shared-types';

async function fetchRecentContentForUser(): Promise<FeedCandidate[]> {
  const client = await createSupabaseServerClient();
  if (!client) {
    return [];
  }

  const { data, error } = await client
    .from('content_items')
    .select('id, external_id, title, channel_name, channel_id, channel_description, channel_subscriber_count, source_kind, published_at, classifications(topics, quality_score, content_type, language, format)')
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
      thumbnail_url: `https://i.ytimg.com/vi/${row.external_id}/hqdefault.jpg`,
      channel_id: row.channel_id,
      channel_description: row.channel_description,
      channel_subscriber_count: row.channel_subscriber_count,
      source_kind: row.source_kind,
      subscription_affinity: row.source_kind === 'subscription' ? 25 : 0,
      content_type: classification?.content_type ?? null,
      language: classification?.language ?? null,
      format: classification?.format ?? null,
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

export async function GET(request: Request) {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { ensureDefaultAlgorithmsForUser } = await import('@/lib/bootstrap');
  const algorithms = await ensureDefaultAlgorithmsForUser(userId);
  const requestedMode = new URL(request.url).searchParams.get('mode')?.trim().toLowerCase();
  const searchParams = new URL(request.url).searchParams;
  const sourceFilters: FeedSourceFilters = {
    subscribedOnly: searchParams.get('subscribedOnly') === 'true',
    includeDiscovery: searchParams.get('includeDiscovery') !== 'false',
    includeShorts: searchParams.get('includeShorts') !== 'false',
    includeLive: searchParams.get('includeLive') !== 'false',
  };
  const activeAlgorithm = (requestedMode
    ? algorithms.find((algorithm) => algorithm.name.trim().toLowerCase() === requestedMode)
    : null) ?? algorithms.find((algorithm) => algorithm.is_active) ?? algorithms[0] ?? null;
  const feedbackSignals = await fetchFeedbackSignalsForUser(userId);
  const activitySignals = await fetchActivitySignalsForUser(userId);
  const liveItems = await fetchRecentContentForUser();
  const response = buildFeedResponse(activeAlgorithm, feedbackSignals, liveItems.length > 0 ? liveItems : undefined, { sourceFilters, activitySignals });

  if (activeAlgorithm?.id) {
    await persistFeedCacheForUser(userId, activeAlgorithm.id, response.items);
  }

  return NextResponse.json(response);
}
