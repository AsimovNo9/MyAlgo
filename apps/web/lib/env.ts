export const env = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://example.supabase.co',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'example-anon-key',
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'example-service-key',
};
