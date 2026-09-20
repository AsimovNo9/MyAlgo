alter table public.content_items
  drop constraint if exists content_items_source_kind_check;

alter table public.content_items
  add constraint content_items_source_kind_check
  check (source_kind in ('subscription', 'discovery', 'liked'));