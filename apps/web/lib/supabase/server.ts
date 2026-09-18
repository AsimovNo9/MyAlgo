import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { env } from '../env';

export async function createSupabaseServerClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey || env.supabaseUrl === 'https://example.supabase.co') {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Ignore if the cookies API is unavailable in this runtime.
        }
      },
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
