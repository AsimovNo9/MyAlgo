import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.ts';

let browserClient: SupabaseClient | null = null;

function hasValidSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function createSupabaseClient() {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!hasValidSupabaseUrl(env.supabaseUrl) || !env.supabaseAnonKey || env.supabaseAnonKey === 'example-anon-key') {
    console.error('Supabase browser configuration is missing or invalid.');
    return null;
  }

  if (!browserClient) {
    browserClient = createBrowserClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}
