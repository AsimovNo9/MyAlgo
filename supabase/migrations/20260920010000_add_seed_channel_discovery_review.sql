-- Add review metadata for channels discovered by the shared YouTube search job.
alter table public.topic_seed_channels
  add column if not exists status text not null default 'approved'
    check (status in ('pending', 'approved', 'rejected')),
  add column if not exists confidence numeric check (confidence >= 0 and confidence <= 1),
  add column if not exists channel_name text,
  add column if not exists channel_description text,
  add column if not exists subscriber_count bigint,
  add column if not exists discovered_at timestamptz;

create index if not exists topic_seed_channels_status_topic_idx
  on public.topic_seed_channels (status, topic);
