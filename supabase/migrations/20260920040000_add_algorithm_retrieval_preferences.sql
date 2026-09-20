alter table public.algorithms
  add column if not exists language text,
  add column if not exists preferred_formats text[] not null default '{}';