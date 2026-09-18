import { NextResponse } from 'next/server';
import { getCurrentUserIdFromServer } from '@/lib/server-user';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function POST() {
  const userId = await getCurrentUserIdFromServer();

  if (!userId) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const client = await createSupabaseServerClient();
  if (!client) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: 'Unable to resolve the current user.' }, { status: 401 });
  }

  const identity = userData.user.identities?.find((item) => item.provider === 'google');
  const accessToken = identity?.identity_data?.access_token;
  const refreshToken = identity?.identity_data?.refresh_token;

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: 'Google OAuth tokens were not returned for this session.' }, { status: 400 });
  }

  const { error } = await client.from('oauth_connections').upsert(
    {
      user_id: userId,
      provider: 'youtube',
      access_token_encrypted: accessToken,
      refresh_token_encrypted: refreshToken,
      scope: 'https://www.googleapis.com/auth/youtube.readonly',
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'user_id,provider' },
  );

  if (error) {
    console.error('Failed to store YouTube OAuth connection', error);
    return NextResponse.json({ error: 'Failed to persist YouTube OAuth connection.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, provider: 'youtube' });
}
