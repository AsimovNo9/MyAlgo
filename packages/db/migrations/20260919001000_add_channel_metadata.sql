-- Add channel profile data used by the enriched YouTube sync and ranking model.
alter table public.content_items
  add column if not exists channel_description text,
  add column if not exists channel_subscriber_count bigint;