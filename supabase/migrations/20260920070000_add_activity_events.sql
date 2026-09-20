create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  event_type text not null check (event_type in ('opened', 'watch_progress', 'completed', 'skipped', 'revisited')),
  watch_seconds integer check (watch_seconds is null or (watch_seconds >= 0 and watch_seconds <= 86400)),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists activity_events_user_created_at_idx on public.activity_events (user_id, created_at desc);

alter table public.activity_events enable row level security;
create policy "own rows only" on public.activity_events
  using (auth.uid() = user_id) with check (auth.uid() = user_id);