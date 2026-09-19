-- Keep one seeded default algorithm per user and prevent future duplicates.
with ranked_defaults as (
  select
    id,
    row_number() over (
      partition by user_id, lower(name)
      order by created_at asc, id asc
    ) as duplicate_rank
  from public.algorithms
  where lower(name) in ('work', 'learning', 'relax')
)
delete from public.algorithms
where id in (
  select id
  from ranked_defaults
  where duplicate_rank > 1
);

create unique index if not exists algorithms_one_seeded_default_per_user
  on public.algorithms (user_id, lower(name))
  where lower(name) in ('work', 'learning', 'relax');