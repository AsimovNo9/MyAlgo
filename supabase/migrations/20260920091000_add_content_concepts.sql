-- Persist candidate-to-concept matches separately from the coarse classification row.
create table if not exists public.content_concepts (
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  concept_id uuid not null references public.concept_entries(id) on delete cascade,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  source text not null check (source in ('deterministic', 'graph', 'embedding', 'llm')),
  model_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (content_item_id, concept_id)
);

alter table public.content_concepts enable row level security;
drop policy if exists "authenticated users can read content concepts" on public.content_concepts;
create policy "authenticated users can read content concepts" on public.content_concepts
  for select using (auth.uid() is not null);