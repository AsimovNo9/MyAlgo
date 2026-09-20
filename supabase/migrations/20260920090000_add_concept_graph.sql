-- Extend the persisted concept catalog into a versioned, reviewable graph.
alter table public.concept_entries
  add column if not exists description text,
  add column if not exists language text,
  add column if not exists source text not null default 'curated' check (source in ('curated', 'platform', 'user', 'content', 'llm')),
  add column if not exists status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  add column if not exists provenance jsonb not null default '{}'::jsonb,
  add column if not exists version integer not null default 1;

create table if not exists public.concept_aliases (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.concept_entries(id) on delete cascade,
  phrase text not null,
  language text,
  weight numeric not null default 1 check (weight >= 0 and weight <= 1),
  source text not null default 'curated' check (source in ('curated', 'platform', 'user', 'content', 'llm')),
  version integer not null default 1,
  unique (concept_id, phrase, language)
);

create table if not exists public.concept_relations (
  id uuid primary key default gen_random_uuid(),
  source_concept_id uuid not null references public.concept_entries(id) on delete cascade,
  target_concept_id uuid not null references public.concept_entries(id) on delete cascade,
  relation_type text not null check (relation_type in ('parent_of', 'child_of', 'related_to', 'alias_of', 'example_of', 'contrasts_with', 'often_cooccurs_with', 'format_for')),
  weight numeric not null default 1 check (weight >= 0 and weight <= 1),
  source text not null default 'curated' check (source in ('curated', 'platform', 'user', 'content', 'llm')),
  provenance jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  unique (source_concept_id, target_concept_id, relation_type)
);

alter table public.concept_aliases enable row level security;
drop policy if exists "authenticated users can read concept aliases" on public.concept_aliases;
create policy "authenticated users can read concept aliases" on public.concept_aliases
  for select using (auth.uid() is not null);

alter table public.concept_relations enable row level security;
drop policy if exists "authenticated users can read concept relations" on public.concept_relations;
create policy "authenticated users can read concept relations" on public.concept_relations
  for select using (auth.uid() is not null);