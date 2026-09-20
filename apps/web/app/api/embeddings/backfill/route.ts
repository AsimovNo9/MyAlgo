import { NextResponse } from 'next/server';
import { backfillContentEmbeddings } from '@/lib/embeddings';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 25);
  return NextResponse.json(await backfillContentEmbeddings(Number.isFinite(limit) ? limit : 25));
}