-- Add structured metadata required by the semantic catalog loader.
alter table public.concept_entries
  add column if not exists entities text[] not null default '{}',
  add column if not exists positive_phrases text[] not null default '{}',
  add column if not exists negative_phrases text[] not null default '{}';