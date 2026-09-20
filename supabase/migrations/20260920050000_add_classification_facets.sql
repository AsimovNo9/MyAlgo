alter table public.classifications
  add column if not exists language text,
  add column if not exists format text;