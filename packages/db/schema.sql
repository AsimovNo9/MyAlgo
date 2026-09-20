-- Supabase manages auth.users; this extends it with app-specific fields
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
  language text,
  preferred_formats text[] not null default '{}',
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

create table public.concept_entries (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null unique,
  aliases text[] not null default '{}',
  intents text[] not null default '{}',
  entities text[] not null default '{}',
  positive_phrases text[] not null default '{}',
  negative_phrases text[] not null default '{}',
  description text,
  language text,
  source text not null default 'curated' check (source in ('curated', 'platform', 'user', 'content', 'llm')),
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  provenance jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table public.concept_aliases (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.concept_entries(id) on delete cascade,
  phrase text not null,
  language text,
  weight numeric not null default 1 check (weight >= 0 and weight <= 1),
  source text not null default 'curated' check (source in ('curated', 'platform', 'user', 'content', 'llm')),
  version integer not null default 1,
  unique (concept_id, phrase, language)
);

create table public.concept_relations (
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

create table public.algorithm_intent_profiles (
  id uuid primary key default gen_random_uuid(),
  algorithm_id uuid not null references public.algorithms(id) on delete cascade,
  canonical_topics text[] not null default '{}',
  aliases text[] not null default '{}',
  intents text[] not null default '{}',
  semantic_terms text[] not null default '{}',
  generated_at timestamptz not null default now(),
  unique (algorithm_id)
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
  source_kind text not null default 'subscription' check (source_kind in ('subscription', 'discovery', 'liked')),
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
  language text,
  format text,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  quality_score numeric,
  reasoning text,
  classified_at timestamptz not null default now()
);

create table public.content_concepts (
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  concept_id uuid not null references public.concept_entries(id) on delete cascade,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  source text not null check (source in ('deterministic', 'graph', 'embedding', 'llm')),
  model_version text not null,
  concept_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (content_item_id, concept_id)
);

create table public.concept_embeddings (
  concept_id uuid not null references public.concept_entries(id) on delete cascade,
  model_version text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  primary key (concept_id, model_version)
);

create table public.content_embeddings (
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  model_version text not null,
  embedding extensions.vector(1536) not null,
  created_at timestamptz not null default now(),
  primary key (content_item_id, model_version)
);

create table public.feed_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  algorithm_id uuid not null references public.algorithms(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  score numeric not null,
  rank int not null,
  visible boolean not null default true,
  semantic_path jsonb,
  generated_at timestamptz not null default now()
);

create table public.feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  event_type text not null check (event_type in ('not_interested','more_like_this','never_show_channel')),
  created_at timestamptz not null default now()
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  event_type text not null check (event_type in ('opened', 'watch_progress', 'completed', 'skipped', 'revisited')),
  watch_seconds integer check (watch_seconds is null or (watch_seconds >= 0 and watch_seconds <= 86400)),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.taste_profile_affinities (
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

create index on public.activity_events (user_id, created_at desc);

create index on public.feed_cache (user_id, algorithm_id, rank);
create index on public.classifications (content_item_id);
create unique index if not exists algorithms_one_seeded_default_per_user
  on public.algorithms (user_id, lower(name))
  where lower(name) in ('work', 'learning', 'relax');
create unique index if not exists algorithms_one_name_per_user
  on public.algorithms (user_id, lower(btrim(name)));
create unique index if not exists algorithms_one_active_per_user
  on public.algorithms (user_id)
  where is_active = true;
create index on public.content_items (channel_id);
create index on public.content_items (source_kind);
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

alter table public.concept_entries enable row level security;
create policy "authenticated users can read concept catalog" on public.concept_entries
  for select using (auth.uid() is not null);
create policy "authenticated users can insert concept catalog entries" on public.concept_entries
  for insert with check (auth.uid() is not null);

alter table public.concept_aliases enable row level security;
create policy "authenticated users can read concept aliases" on public.concept_aliases
  for select using (auth.uid() is not null);

alter table public.concept_relations enable row level security;
create policy "authenticated users can read concept relations" on public.concept_relations
  for select using (auth.uid() is not null);

alter table public.algorithm_intent_profiles enable row level security;
create policy "own rows only" on public.algorithm_intent_profiles
  using (exists (
    select 1 from public.algorithms a
    where a.id = algorithm_intent_profiles.algorithm_id and a.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.algorithms a
    where a.id = algorithm_intent_profiles.algorithm_id and a.user_id = auth.uid()
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

alter table public.content_concepts enable row level security;
create policy "authenticated users can read content concepts" on public.content_concepts
  for select using (auth.uid() is not null);

alter table public.concept_embeddings enable row level security;
create policy "authenticated users can read concept embeddings" on public.concept_embeddings
  for select using (auth.uid() is not null);

alter table public.content_embeddings enable row level security;
create policy "authenticated users can read content embeddings" on public.content_embeddings
  for select using (auth.uid() is not null);

alter table public.feed_cache enable row level security;
create policy "own rows only" on public.feed_cache
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.feedback_events enable row level security;
create policy "own rows only" on public.feedback_events
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.activity_events enable row level security;
create policy "own rows only" on public.activity_events
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.taste_profile_affinities enable row level security;
create policy "own rows only" on public.taste_profile_affinities
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.topic_seed_channels (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  channel_id text not null,
  source text not null default 'curated' check (source in ('curated', 'discovered_via_search')),
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  confidence numeric check (confidence >= 0 and confidence <= 1),
  channel_name text,
  channel_description text,
  subscriber_count bigint,
  discovered_at timestamptz,
  added_at timestamptz not null default now(),
  unique (topic, channel_id)
);

alter table public.topic_seed_channels enable row level security;
create policy "authenticated users can read seed channels" on public.topic_seed_channels
  for select using (auth.uid() is not null);
create policy "authenticated users can insert seed channels" on public.topic_seed_channels
  for insert with check (auth.uid() is not null);

create table public.topic_discovery_runs (
  topic text primary key,
  last_run_at timestamptz not null default now(),
  candidate_count integer not null default 0
);

alter table public.topic_discovery_runs enable row level security;
create policy "authenticated users can read discovery runs" on public.topic_discovery_runs
  for select using (auth.uid() is not null);
