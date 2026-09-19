import type { Session } from '@supabase/supabase-js';
import { createSupabaseClient } from './supabase/client.ts';
import { getProviderConfig } from './supabase/provider.ts';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export type GoogleProviderTokenBundle = {
  accessToken: string | null;
  refreshToken: string | null;
  source: 'session_provider_token' | 'google_identity_data' | 'missing';
};

export function extractGoogleProviderTokens(
  session: {
    provider_token?: string | null;
    provider_refresh_token?: string | null;
    user?: {
      identities?: Array<{
        provider?: string | null;
        identity_data?: {
          access_token?: string | null;
          refresh_token?: string | null;
        } | null;
      }> | null;
    } | null;
  } | null | undefined,
): GoogleProviderTokenBundle {
  const googleIdentity = session?.user?.identities?.find((item) => item.provider === 'google');
  const accessToken = session?.provider_token ?? googleIdentity?.identity_data?.access_token ?? null;
  const refreshToken = session?.provider_refresh_token ?? googleIdentity?.identity_data?.refresh_token ?? null;

  if (session?.provider_token || session?.provider_refresh_token) {
    return {
      accessToken: accessToken ?? null,
      refreshToken: refreshToken ?? null,
      source: 'session_provider_token',
    };
  }

  if (googleIdentity?.identity_data?.access_token || googleIdentity?.identity_data?.refresh_token) {
    return {
      accessToken: googleIdentity.identity_data?.access_token ?? null,
      refreshToken: googleIdentity.identity_data?.refresh_token ?? null,
      source: 'google_identity_data',
    };
  }

  return {
    accessToken: null,
    refreshToken: null,
    source: 'missing',
  };
}

export function getUserIdFromSession(session: Session | null | undefined): string | null {
  return session?.user?.id ?? null;
}

export async function getCurrentUserId() {
  if (typeof window === 'undefined') {
    return null;
  }

  const client = createSupabaseClient();

  if (!client) {
    return null;
  }

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  return data.user.id;
}

export async function getCurrentSession() {
  const client = createSupabaseClient();

  if (!client) {
    return null;
  }

  const { data, error } = await client.auth.getSession();
  if (error) {
    console.error('Failed to get session', error);
    return null;
  }

  return data.session;
}

export async function ensureProfileForSession(session: Session | null) {
  const client = createSupabaseClient();

  if (!client || !session?.user) {
    return { error: new Error('Supabase client is not available or no user session exists.') };
  }

  const { error } = await client.from('profiles').upsert(
    {
      id: session.user.id,
      email: session.user.email ?? '',
      plan: 'free',
    },
    { onConflict: 'id' },
  );

  return { error };
}

export async function signInWithGoogle() {
  const client = createSupabaseClient();

  if (!client) {
    return { error: new Error('Supabase env vars are not configured.') };
  }

  const providerConfig = getProviderConfig('google');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${SITE_URL}/auth/callback`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
      scopes: providerConfig?.scopes,
    },
  });

  return { error };
}


export async function signOut() {
  const client = createSupabaseClient();

  if (!client) {
    return { error: new Error('Supabase env vars are not configured.') };
  }

  const { error } = await client.auth.signOut();
  return { error };
}
