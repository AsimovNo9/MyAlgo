import { NextResponse } from 'next/server';
import { syncSeedChannelContent } from '@/lib/seed-channels';

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return true;
  }

  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

// Vercel Cron Jobs call this route with GET and attach CRON_SECRET automatically when
// configured; POST is kept for manual/local triggering. Not per-user, so RSS polling
// stays entirely outside the per-user YouTube Data API quota.
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const result = await syncSeedChannelContent();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  const result = await syncSeedChannelContent();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
