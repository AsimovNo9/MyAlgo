import { NextResponse } from 'next/server';
import type { ActivityRequest } from '@repo/shared-types';
import { normalizeActivityRequest } from '@/lib/activity';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<ActivityRequest>;
    const payload = normalizeActivityRequest(body);
    const userId = await getCurrentUserIdFromServer();

    if (!userId) return NextResponse.json({ error: 'Authentication required to save activity.' }, { status: 401 });

    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });

    const { data: contentItem, error: lookupError } = await client
      .from('content_items')
      .select('id')
      .eq('source', 'youtube')
      .eq('external_id', payload.externalId)
      .maybeSingle();

    if (lookupError) {
      console.error('Failed to resolve content item for activity', lookupError);
      return NextResponse.json({ error: 'Failed to resolve activity item.' }, { status: 500 });
    }

    let contentItemId = contentItem?.id;
    if (!contentItemId) {
      const { data: inserted, error: insertError } = await client
        .from('content_items')
        .insert({ source: 'youtube', external_id: payload.externalId, title: payload.externalId, channel_name: 'unknown' })
        .select('id')
        .single();
      if (insertError || !inserted) {
        console.error('Failed to create content item for activity', insertError);
        return NextResponse.json({ error: 'Failed to save activity item.' }, { status: 500 });
      }
      contentItemId = inserted.id;
    }

    const { error: activityError } = await client.from('activity_events').insert({
      user_id: userId,
      content_item_id: contentItemId,
      event_type: payload.eventType,
      watch_seconds: payload.watchSeconds ?? null,
      occurred_at: payload.occurredAt ?? new Date().toISOString(),
    });

    if (activityError) {
      console.error('Failed to store activity event', activityError);
      return NextResponse.json({ error: 'Failed to save activity event.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, recorded: payload.eventType, externalId: payload.externalId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid activity payload.' }, { status: 400 });
  }
}