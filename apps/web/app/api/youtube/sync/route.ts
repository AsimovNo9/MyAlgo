import { NextResponse } from 'next/server';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { syncYoutubeSubscriptionsForUser } from '@/lib/youtube';

export async function POST() {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const result = await syncYoutubeSubscriptionsForUser(userId);
  return NextResponse.json(result);
}
