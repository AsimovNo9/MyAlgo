-- Curated/discovered channels that seed niche-topic content via free RSS polling,
-- independent of any single user's subscriptions or per-user search quota.
-- Keep this migration aligned with packages/db/schema.sql.

create table if not exists public.topic_seed_channels (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  channel_id text not null,
  source text not null default 'curated' check (source in ('curated', 'discovered_via_search')),
  added_at timestamptz not null default now(),
  unique (topic, channel_id)
);

alter table public.topic_seed_channels enable row level security;

drop policy if exists "authenticated users can read seed channels" on public.topic_seed_channels;
create policy "authenticated users can read seed channels" on public.topic_seed_channels
  for select using (auth.uid() is not null);

drop policy if exists "authenticated users can insert seed channels" on public.topic_seed_channels;
create policy "authenticated users can insert seed channels" on public.topic_seed_channels
  for insert with check (auth.uid() is not null);
