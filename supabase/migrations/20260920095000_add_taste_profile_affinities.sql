create table if not exists public.taste_profile_affinities (
  user_id uuid not null references public.profiles(id) on delete cascade,
  facet text not null check (facet in ('topic', 'channel', 'format', 'language', 'source')),
  facet_key text not null,
  signed_value numeric not null check (signed_value >= -1 and signed_value <= 1),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  evidence_count integer not null check (evidence_count >= 0),
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  source_signals text[] not null default '{}',
  profile_revision timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, facet, facet_key)
);

alter table public.taste_profile_affinities enable row level security;
drop policy if exists "own rows only" on public.taste_profile_affinities;
create policy "own rows only" on public.taste_profile_affinities
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
