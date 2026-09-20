import { NextResponse } from 'next/server';
import type { FeedCandidate } from '@/lib/feed';
import { fetchActivitySignalsForUser } from '@/lib/activity-signals';
import { fetchFeedbackSignalsForUser } from '@/lib/feedback-signals';
import { buildPersistedAffinityRows } from '@/lib/learned-profile';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST() {
  const userId = await getCurrentUserIdFromServer();
  if (!userId) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const client = await createSupabaseServerClient();
  if (!client) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });

  const { data, error } = await client
    .from('content_items')
    .select('external_id, title, channel_name, channel_id, source_kind, classifications(topics, language, format)')
    .order('fetched_at', { ascending: false })
    .limit(5000);
  if (error || !data) {
    console.error('Failed to load historical profile candidates', error);
    return NextResponse.json({ error: 'Unable to rebuild recommendation profile.' }, { status: 500 });
  }

  const candidates: FeedCandidate[] = data.map((row) => {
    const classification = Array.isArray(row.classifications) ? row.classifications[0] : row.classifications;
    return {
      external_id: row.external_id,
      title: row.title,
      channel_name: row.channel_name,
      channel_id: row.channel_id,
      source_kind: row.source_kind,
      topics: classification?.topics ?? [],
      language: classification?.language ?? null,
      format: classification?.format ?? null,
    };
  });
  const [feedbackSignals, activitySignals] = await Promise.all([
    fetchFeedbackSignalsForUser(userId),
    fetchActivitySignalsForUser(userId),
  ]);
  const profileRevision = new Date().toISOString();
  const rows = buildPersistedAffinityRows(candidates, feedbackSignals, activitySignals, profileRevision)
    .map((row) => ({ user_id: userId, ...row }));

  const { error: deleteError } = await client.from('taste_profile_affinities').delete().eq('user_id', userId);
  if (deleteError) {
    console.error('Failed to clear historical recommendation profile', deleteError);
    return NextResponse.json({ error: 'Unable to rebuild recommendation profile.' }, { status: 500 });
  }
  if (rows.length > 0) {
    const { error: insertError } = await client.from('taste_profile_affinities').insert(rows);
    if (insertError) {
      console.error('Failed to persist historical recommendation profile', insertError);
      return NextResponse.json({ error: 'Unable to rebuild recommendation profile.' }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, profileRevision, facetCount: rows.length });
}