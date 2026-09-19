import { NextResponse } from 'next/server';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { fetchYoutubeSubscriptionFeed } from '@/lib/youtube';

export async function GET() {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const feed = await fetchYoutubeSubscriptionFeed(userId);
  return NextResponse.json(feed);
}
