import { NextResponse } from 'next/server';

import type { AlgorithmIntentProfile } from '@/lib/concepts';
import { buildConceptsApiResponse } from '@/lib/concepts';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const client = await createSupabaseServerClient();
  if (!client) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const { data: conceptEntries, error: conceptError } = await client
    .from('concept_entries')
    .select('id, canonical_name, aliases, intents')
    .order('canonical_name', { ascending: true });

  if (conceptError || !conceptEntries) {
    console.error('Failed to load concept catalog', conceptError);
    return NextResponse.json({ error: 'Unable to load the concept catalog.' }, { status: 500 });
  }

  const { data: algorithms, error } = await client
    .from('algorithms')
    .select('id, name, goal_text, topic_weights(topic, weight), rules(type, condition_text), algorithm_intent_profiles(canonical_topics, aliases, intents, semantic_terms)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error || !algorithms) {
    console.error('Failed to load algorithms for concept profile', error);
    return NextResponse.json({ error: 'Unable to load algorithm concept profiles.' }, { status: 500 });
  }

  return NextResponse.json(buildConceptsApiResponse({ conceptEntries, algorithms }));
}

export async function POST(request: Request) {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const payload = (await request.json()) as {
    algorithmId?: string;
    profile?: AlgorithmIntentProfile;
  };

  const algorithmId = payload.algorithmId?.trim();
  const profile = payload.profile;

  if (!algorithmId || !profile) {
    return NextResponse.json({ error: 'algorithmId and profile are required.' }, { status: 400 });
  }

  const client = await createSupabaseServerClient();
  if (!client) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const { error } = await client.from('algorithm_intent_profiles').upsert({
    algorithm_id: algorithmId,
    canonical_topics: profile.canonicalTopics,
    aliases: profile.aliases,
    intents: profile.intents,
    semantic_terms: profile.semanticTerms,
  }, { onConflict: 'algorithm_id' });

  if (error) {
    console.error('Failed to store algorithm intent profile', error);
    return NextResponse.json({ error: 'Unable to save semantic intent profile.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, algorithmId });
}
