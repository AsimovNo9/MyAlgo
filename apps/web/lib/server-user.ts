import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { env } from './env';

export async function getCurrentUserIdFromServer() {
  if (!env.supabaseUrl || !env.supabaseAnonKey || env.supabaseUrl === 'https://example.supabase.co') {
    return null;
  }

  const cookieStore = cookies();
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // no-op in server runtime
        }
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  return data.user.id;
}
