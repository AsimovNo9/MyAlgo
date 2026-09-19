import { NextResponse } from 'next/server';
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

  const { data, error } = await client
    .from('topic_seed_channels')
    .select('id, topic, channel_id, source, added_at')
    .order('topic', { ascending: true });

  if (error || !data) {
    console.error('Failed to load seed channels', error);
    return NextResponse.json({ error: 'Unable to load seed channels.' }, { status: 500 });
  }

  return NextResponse.json({ channels: data });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserIdFromServer();
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const payload = (await request.json()) as { topic?: string; channel_id?: string };
  const topic = payload.topic?.trim();
  const channelId = payload.channel_id?.trim();

  if (!topic || !channelId) {
    return NextResponse.json({ error: 'topic and channel_id are required.' }, { status: 400 });
  }

  const client = await createSupabaseServerClient();
  if (!client) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const { error } = await client
    .from('topic_seed_channels')
    .upsert({ topic, channel_id: channelId, source: 'curated' }, { onConflict: 'topic,channel_id' });

  if (error) {
    console.error('Failed to save seed channel', error);
    return NextResponse.json({ error: 'Unable to save seed channel.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, topic, channel_id: channelId }, { status: 201 });
}
