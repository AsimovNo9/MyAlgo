import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const client = createSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ ok: false, service: 'personal-algorithm', error: 'Supabase is not configured.' }, { status: 503 });
  }

  const { error } = await client.from('profiles').select('id').limit(1);
  if (error) {
    console.error('Health check Supabase query failed', error);
    return NextResponse.json({ ok: false, service: 'personal-algorithm', error: 'Supabase connectivity check failed.' }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    service: 'personal-algorithm',
    dependencies: { supabase: 'ok' },
    timestamp: new Date().toISOString(),
  });
}
