-- Persist canonical concepts and per-algorithm semantic intent profiles.
-- Keep this migration aligned with packages/db/schema.sql.

create table if not exists public.concept_entries (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  aliases text[] not null default '{}',
  intents text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.algorithm_intent_profiles (
  id uuid primary key default gen_random_uuid(),
  algorithm_id uuid not null references public.algorithms(id) on delete cascade,
  canonical_topics text[] not null default '{}',
  aliases text[] not null default '{}',
  intents text[] not null default '{}',
  semantic_terms text[] not null default '{}',
  generated_at timestamptz not null default now(),
  unique (algorithm_id)
);

alter table public.concept_entries enable row level security;

drop policy if exists "authenticated users can read concept catalog" on public.concept_entries;
create policy "authenticated users can read concept catalog" on public.concept_entries
  for select using (auth.uid() is not null);

drop policy if exists "authenticated users can insert concept catalog entries" on public.concept_entries;
create policy "authenticated users can insert concept catalog entries" on public.concept_entries
  for insert with check (auth.uid() is not null);

alter table public.algorithm_intent_profiles enable row level security;

drop policy if exists "own rows only" on public.algorithm_intent_profiles;
create policy "own rows only" on public.algorithm_intent_profiles
  using (exists (
    select 1 from public.algorithms a
    where a.id = algorithm_intent_profiles.algorithm_id and a.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.algorithms a
    where a.id = algorithm_intent_profiles.algorithm_id and a.user_id = auth.uid()
  ));
