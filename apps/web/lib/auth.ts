import type { Session } from '@supabase/supabase-js';
import { createSupabaseClient } from './supabase/client';
import { getProviderConfig } from './supabase/provider';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

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
