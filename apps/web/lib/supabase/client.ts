import { createClient } from '@supabase/supabase-js';
import { env } from '../env';

export function createSupabaseClient() {
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
