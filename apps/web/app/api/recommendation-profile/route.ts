import { NextResponse } from 'next/server';
import type { FeedCandidate } from '@/lib/feed';
import { fetchActivitySignalsForUser } from '@/lib/activity-signals';
import { fetchFeedbackSignalsForUser } from '@/lib/feedback-signals';
import { buildLearnedAffinityProfile } from '@/lib/learned-profile';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function serializeFacet(map: Map<string, number>) {
  return [...map.entries()]
    .filter(([, strength]) => Math.abs(strength) >= 0.05)
    .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
    .slice(0, 8)
    .map(([key, strength]) => ({
      key,
      strength: Number(strength.toFixed(2)),
      confidence: Number(Math.min(1, Math.abs(strength)).toFixed(2)),
    }));
}

export async function GET() {
  const userId = await getCurrentUserIdFromServer();
  if (!userId) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const client = await createSupabaseServerClient();
  if (!client) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });

  const { data, error } = await client
    .from('content_items')
    .select('external_id, title, channel_name, channel_id, source_kind, classifications(topics, language, format)')
    .order('fetched_at', { ascending: false })
    .limit(200);

  if (error || !data) {
    console.error('Failed to load recommendation profile candidates', error);
    return NextResponse.json({ error: 'Unable to load recommendation profile.' }, { status: 500 });
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
  const profile = buildLearnedAffinityProfile(candidates, feedbackSignals, activitySignals);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    facets: {
      topics: serializeFacet(profile.topics),
      channels: serializeFacet(profile.channels),
      formats: serializeFacet(profile.formats),
      languages: serializeFacet(profile.languages),
      sources: serializeFacet(profile.sources),
    },
  });
}
