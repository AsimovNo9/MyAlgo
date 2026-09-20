alter table public.classifications
  add column if not exists confidence numeric
  check (confidence is null or (confidence >= 0 and confidence <= 1));