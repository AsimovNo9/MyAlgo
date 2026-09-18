import { NextResponse } from 'next/server';
import { buildFeedResponse, type FeedFeedbackSignal } from '@/lib/feed';
import { listAlgorithms } from '@/lib/data';
import { getCurrentUserId } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

async function fetchFeedbackSignalsForUser(userId: string): Promise<FeedFeedbackSignal[]> {
  const client = createSupabaseServerClient();
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

export async function GET() {
  const userId = (await getCurrentUserId()) ?? 'demo-user';
  const algorithms = await listAlgorithms(userId);
  const activeAlgorithm = algorithms.find((algorithm) => algorithm.is_active) ?? algorithms[0] ?? null;
  const feedbackSignals = await fetchFeedbackSignalsForUser(userId);

  return NextResponse.json(buildFeedResponse(activeAlgorithm, feedbackSignals));
}
