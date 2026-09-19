-- Initial application schema for Personal Algorithm.
-- Keep this migration in sync with packages/db/schema.sql.

-- Supabase manages auth.users; this extends it with app-specific fields.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  plan text not null default 'free'
);

create table public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  scope text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.algorithms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  is_active boolean not null default false,
  goal_text text,
  created_at timestamptz not null default now()
);

create table public.topic_weights (
  id uuid primary key default gen_random_uuid(),
  algorithm_id uuid not null references public.algorithms(id) on delete cascade,
  topic text not null,
  weight numeric not null check (weight >= 0 and weight <= 100)
);

create table public.rules (
  id uuid primary key default gen_random_uuid(),
  algorithm_id uuid not null references public.algorithms(id) on delete cascade,
  type text not null check (type in ('always_show','never_show','priority')),
  condition_text text not null,
  created_at timestamptz not null default now()
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'youtube',
  external_id text not null,
  title text not null,
  channel_name text,
  channel_id text,
  channel_description text,
  channel_subscriber_count bigint,
  published_at timestamptz,
  raw_metadata jsonb,
  fetched_at timestamptz not null default now(),
  unique (source, external_id)
);

create table public.classifications (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  topics text[] not null default '{}',
  content_type text,
  quality_score numeric,
  reasoning text,
  classified_at timestamptz not null default now()
);

create table public.feed_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  algorithm_id uuid not null references public.algorithms(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  score numeric not null,
  rank int not null,
  visible boolean not null default true,
  generated_at timestamptz not null default now()
);

create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  event_type text not null check (event_type in ('not_interested','more_like_this','never_show_channel')),
  created_at timestamptz not null default now()
);

create index on public.feed_cache (user_id, algorithm_id, rank);
create index on public.classifications (content_item_id);
create index on public.content_items (channel_id);
create unique index classifications_content_item_id_key on public.classifications (content_item_id);

alter table public.profiles enable row level security;
create policy "own rows only" on public.profiles
  using (auth.uid() = id) with check (auth.uid() = id);

alter table public.oauth_connections enable row level security;
create policy "own rows only" on public.oauth_connections
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.algorithms enable row level security;
create policy "own rows only" on public.algorithms
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.topic_weights enable row level security;
create policy "own rows only" on public.topic_weights
  using (exists (
    select 1 from public.algorithms a
    where a.id = topic_weights.algorithm_id and a.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.algorithms a
    where a.id = topic_weights.algorithm_id and a.user_id = auth.uid()
  ));

alter table public.rules enable row level security;
create policy "own rows only" on public.rules
  using (exists (
    select 1 from public.algorithms a
    where a.id = rules.algorithm_id and a.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.algorithms a
    where a.id = rules.algorithm_id and a.user_id = auth.uid()
  ));

alter table public.content_items enable row level security;
create policy "authenticated users can read public content" on public.content_items
  for select using (auth.uid() is not null);
create policy "authenticated users can insert content" on public.content_items
  for insert with check (auth.uid() is not null);

alter table public.classifications enable row level security;
create policy "authenticated users can read classifications for visible items" on public.classifications
  for select using (auth.uid() is not null);
create policy "authenticated users can insert classifications" on public.classifications
  for insert with check (auth.uid() is not null);

alter table public.feed_cache enable row level security;
create policy "own rows only" on public.feed_cache
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.feedback_events enable row level security;
create policy "own rows only" on public.feedback_events
  using (auth.uid() = user_id) with check (auth.uid() = user_id);