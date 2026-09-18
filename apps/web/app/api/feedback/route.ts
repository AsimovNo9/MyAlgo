import { NextResponse } from 'next/server';
import type { FeedbackRequest } from '@repo/shared-types';

export async function POST(request: Request) {
  const payload = (await request.json()) as FeedbackRequest;

  return NextResponse.json({
    ok: true,
    recorded: payload.eventType,
    contentItemId: payload.contentItemId,
    note: 'Feedback events are accepted and queued for future scoring adjustments.',
  });
}
