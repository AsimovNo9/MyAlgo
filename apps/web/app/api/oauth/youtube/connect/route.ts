import { NextResponse } from 'next/server';
import { extractGoogleProviderTokens } from '@/lib/auth';
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

  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData.session) {
    console.error('Missing Supabase session during YouTube connect', sessionError);
    return NextResponse.json({ error: 'Unable to resolve the current session.' }, { status: 401 });
  }

  const googleIdentity = sessionData.session.user?.identities?.find((item) => item.provider === 'google');
  const providerTokens = extractGoogleProviderTokens(sessionData.session);
  const accessToken = providerTokens.accessToken;
  const refreshToken = providerTokens.refreshToken;

  console.log('YouTube connect session debug', {
    tokenSource: providerTokens.source,
    hasProviderToken: !!sessionData.session.provider_token,
    hasProviderRefreshToken: !!sessionData.session.provider_refresh_token,
    hasGoogleIdentity: !!googleIdentity,
    identityProvider: googleIdentity?.provider ?? null,
    identityDataKeys: googleIdentity?.identity_data ? Object.keys(googleIdentity.identity_data) : [],
    userId: sessionData.session.user?.id ?? null,
    email: sessionData.session.user?.email ?? null,
    accessTokenPresent: !!accessToken,
    refreshTokenPresent: !!refreshToken,
  });

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
