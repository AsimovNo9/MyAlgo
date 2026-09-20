-- Keep one newest row per user/name and one active algorithm per user.
with ranked_names as (
  select id,
    row_number() over (
      partition by user_id, lower(btrim(name))
      order by created_at desc, id desc
    ) as row_number
  from public.algorithms
)
delete from public.algorithms
where id in (select id from ranked_names where row_number > 1);

with ranked_active as (
  select id,
    row_number() over (
      partition by user_id
      order by created_at desc, id desc
    ) as row_number
  from public.algorithms
  where is_active = true
)
update public.algorithms
set is_active = false
where id in (select id from ranked_active where row_number > 1);

create unique index if not exists algorithms_one_name_per_user
  on public.algorithms (user_id, lower(btrim(name)));

create unique index if not exists algorithms_one_active_per_user
  on public.algorithms (user_id)
  where is_active = true;
