alter table public.feed_cache
  add column if not exists semantic_path jsonb;
