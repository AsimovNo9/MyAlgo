-- Deduplicate cold-start discovery by canonical topic across all users.
create table if not exists public.topic_discovery_runs (
  topic text primary key,
  last_run_at timestamptz not null default now(),
  candidate_count integer not null default 0
);

alter table public.topic_discovery_runs enable row level security;

drop policy if exists "authenticated users can read discovery runs" on public.topic_discovery_runs;
create policy "authenticated users can read discovery runs" on public.topic_discovery_runs
  for select using (auth.uid() is not null);
