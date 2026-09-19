alter table public.content_items
  add column if not exists source_kind text not null default 'subscription'
  check (source_kind in ('subscription', 'discovery'));

create index if not exists content_items_source_kind_idx on public.content_items (source_kind);