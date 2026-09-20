import { NextResponse } from 'next/server';
import { normalizeSemanticContextEntry } from '@/lib/concepts';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const payload = await request.json() as { entries?: unknown[] };
  const entries = Array.isArray(payload.entries) ? payload.entries.slice(0, 100) : [];
  if (entries.length === 0) return NextResponse.json({ error: 'entries must contain at least one item.' }, { status: 400 });

  const client = createSupabaseAdminClient();
  if (!client) return NextResponse.json({ error: 'Supabase admin client is not configured.' }, { status: 500 });

  let processed = 0;
  let pending = 0;
  let failed = 0;
  for (const input of entries) {
    const normalized = normalizeSemanticContextEntry(input);
    if (!normalized) {
      failed += 1;
      continue;
    }

    const { data: existing } = await client
      .from('concept_entries')
      .select('status, version')
      .eq('canonical_name', normalized.canonical_name)
      .maybeSingle();
    const preservedStatus = existing?.status === 'approved' || existing?.status === 'rejected'
      ? existing.status
      : normalized.status;
    const nextVersion = Math.max(normalized.version, Number(existing?.version) || 0);
    const { error } = await client.from('concept_entries').upsert({
      ...normalized,
      status: preservedStatus,
      version: nextVersion,
      provenance: {
        ...normalized.provenance,
        ingestion: 'reviewed-semantic-context',
        ingested_at: new Date().toISOString(),
      },
    }, { onConflict: 'canonical_name' });
    if (error) {
      failed += 1;
      console.error('Failed to ingest semantic context entry', error);
      continue;
    }
    processed += 1;
    if (preservedStatus === 'pending') pending += 1;
  }

  return NextResponse.json({
    ok: failed === 0,
    processed,
    pending,
    failed,
    embeddingBackfillRequired: processed > 0,
  }, { status: failed === entries.length ? 400 : 200 });
}