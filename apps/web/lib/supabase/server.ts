import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import { env } from '../env';

export async function createSupabaseServerClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey || env.supabaseAnonKey === 'example-anon-key') {
    return null;
  }

  try {
    const cookieStore = await cookies();
    const authorization = headers().get('authorization');

    return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
      global: authorization ? { headers: { Authorization: authorization } } : undefined,
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
        }
      },
    });
  } catch (error) {
    console.error('Failed to initialize Supabase server client', error);
    return null;
  }
}

export function createSupabaseAdminClient() {
  if (!env.supabaseUrl || !env.serviceRoleKey || env.serviceRoleKey === 'example-service-key') {
    return null;
  }

  try {
    return createClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  } catch (error) {
    console.error('Failed to initialize Supabase admin client', error);
    return null;
  }
}
