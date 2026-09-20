import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const client = createSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: 'Supabase admin client is not configured.' }, { status: 503 });
  }

  const { count, error } = await client
    .from('content_embeddings')
    .select('content_item_id', { count: 'exact', head: true });

  if (error) {
    console.error('Embedding status query failed', error);
    return NextResponse.json({ ok: false, error: 'Unable to query embedding storage.' }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    providerConfigured: Boolean(process.env.EMBEDDING_API_KEY?.trim()),
    providerUrlConfigured: Boolean(process.env.EMBEDDING_API_URL?.trim()),
    model: process.env.EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
    modelVersion: process.env.EMBEDDING_MODEL_VERSION?.trim() || process.env.EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
    storedEmbeddingCount: count ?? 0,
  });
}
