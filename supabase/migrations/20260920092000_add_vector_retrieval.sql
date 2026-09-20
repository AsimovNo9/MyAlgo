-- Optional semantic retrieval index. Embedding generation remains sync/activation work.
create extension if not exists vector with schema extensions;

create table if not exists public.concept_embeddings (
  concept_id uuid not null references public.concept_entries(id) on delete cascade,
  model_version text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  primary key (concept_id, model_version)
);

create table if not exists public.content_embeddings (
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  model_version text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  primary key (content_item_id, model_version)
);

create index if not exists content_embeddings_hnsw_idx
  on public.content_embeddings using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.match_content_embeddings(
  query_embedding extensions.vector(1536),
  match_threshold double precision default 0.75,
  match_count integer default 50,
  requested_model_version text default null
)
returns table (content_item_id uuid, similarity double precision, model_version text)
language sql stable
set search_path = public, extensions
as $$
  select
    content_item_id,
    1 - (embedding <=> query_embedding) as similarity,
    content_embeddings.model_version
  from public.content_embeddings
  where (requested_model_version is null or content_embeddings.model_version = requested_model_version)
    and 1 - (embedding <=> query_embedding) >= match_threshold
  order by embedding <=> query_embedding
  limit greatest(1, least(match_count, 100));
$$;

alter table public.concept_embeddings enable row level security;
create policy "authenticated users can read concept embeddings" on public.concept_embeddings
  for select using (auth.uid() is not null);

alter table public.content_embeddings enable row level security;
create policy "authenticated users can read content embeddings" on public.content_embeddings
  for select using (auth.uid() is not null);