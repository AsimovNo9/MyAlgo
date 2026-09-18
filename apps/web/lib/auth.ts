import { createSupabaseClient } from './supabase/client';
import { getProviderConfig } from './supabase/provider';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

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
