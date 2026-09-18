import { createClient } from '@supabase/supabase-js';
import { env } from '../env';

export function createSupabaseServerClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey || env.supabaseUrl === 'https://example.supabase.co') {
    return null;
  }

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createSupabaseAdminClient() {
  if (!env.supabaseUrl || !env.serviceRoleKey || env.supabaseUrl === 'https://example.supabase.co') {
    return null;
  }

  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
