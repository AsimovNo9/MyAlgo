import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { fetchYoutubeSubscriptionFeed } from '@/lib/youtube';

export async function GET() {
  const userId = await getCurrentUserId();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const feed = await fetchYoutubeSubscriptionFeed(userId);
  return NextResponse.json(feed);
}
