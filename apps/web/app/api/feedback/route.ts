import { NextResponse } from 'next/server';
import { normalizeFeedbackRequest } from '@/lib/feedback';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<Parameters<typeof normalizeFeedbackRequest>[0]>;
    const payload = normalizeFeedbackRequest(body);
    const userId = await getCurrentUserIdFromServer();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required to save feedback.' }, { status: 401 });
    }

    const client = await createSupabaseServerClient();
    if (!client) {
      return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
    }

    const { data: contentItem, error: contentItemError } = await client
      .from('content_items')
      .select('id')
      .eq('source', 'youtube')
      .eq('external_id', payload.contentItemId)
      .maybeSingle();

    if (contentItemError) {
      console.error('Failed to resolve content item for feedback', contentItemError);
      return NextResponse.json({ error: 'Failed to resolve content item.' }, { status: 500 });
    }

    const contentItemId = contentItem?.id ?? null;

    if (!contentItemId) {
      const { data: insertedContent, error: insertContentError } = await client
        .from('content_items')
        .insert({
          source: 'youtube',
          external_id: payload.contentItemId,
          title: payload.contentItemId,
          channel_name: 'unknown',
        })
        .select('id')
        .single();

      if (insertContentError || !insertedContent) {
        console.error('Failed to create content item for feedback', insertContentError);
        return NextResponse.json({ error: 'Failed to save feedback item.' }, { status: 500 });
      }

      const { error: feedbackError } = await client.from('feedback_events').insert({
        user_id: userId,
        content_item_id: insertedContent.id,
        event_type: payload.eventType,
      });

      if (feedbackError) {
        console.error('Failed to store feedback event', feedbackError);
        return NextResponse.json({ error: 'Failed to save feedback event.' }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        recorded: payload.eventType,
        contentItemId: payload.contentItemId,
        note: 'Feedback events are stored for future scoring adjustments.',
      });
    }

    const { error: feedbackError } = await client.from('feedback_events').insert({
      user_id: userId,
      content_item_id: contentItemId,
      event_type: payload.eventType,
    });

    if (feedbackError) {
      console.error('Failed to store feedback event', feedbackError);
      return NextResponse.json({ error: 'Failed to save feedback event.' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      recorded: payload.eventType,
      contentItemId: payload.contentItemId,
      note: 'Feedback events are stored for future scoring adjustments.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid feedback payload.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
