alter table public.content_concepts
  add column if not exists concept_version integer not null default 1;
