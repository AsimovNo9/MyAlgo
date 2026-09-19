import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { env } from './env';

export async function getCurrentUserIdFromServer() {
  if (!env.supabaseUrl || !env.supabaseAnonKey || env.supabaseUrl === 'https://example.supabase.co') {
    return null;
  }

  const cookieStore = await cookies();
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

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.error('Failed to read Supabase session on server', sessionError);
  }

  const cookieNames = cookieStore.getAll().map((cookie) => cookie.name);
  console.log('Supabase cookie names on server request', cookieNames);

  if (sessionData.session?.user) {
    const user = sessionData.session.user;
    const { error: profileError } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        email: user.email ?? '',
        plan: 'free',
      },
      { onConflict: 'id' },
    );

    if (profileError) {
      console.error('Failed to ensure profile for server session user', profileError);
    }

    console.log('Server session user found', user.id);
    return user.id;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    console.log('No server user found; auth error:', error);
    return null;
  }

  const { error: profileError } = await supabase.from('profiles').upsert(
    {
      id: data.user.id,
      email: data.user.email ?? '',
      plan: 'free',
    },
    { onConflict: 'id' },
  );

  if (profileError) {
    console.error('Failed to ensure profile for resolved user', profileError);
  }

  console.log('Server user found via getUser', data.user.id);
  return data.user.id;
}
