-- Bug review (2026-10-20, PLAN.md §12 "Bug review"), batch 4: small things. Additive.

-- ---------------------------------------------------------------------------
-- 1. List items must be real text: bool_and skips NULLs, so a list like {NULL} or {NULL,'x'} passed the "1 to N
--    characters" rule (and "null" then reached the AI prompt). Old rows are not re-checked.
-- ---------------------------------------------------------------------------
create or replace function public.short_items(items text[], max_len integer) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(item is not null and char_length(item) between 1 and max_len), true) from unnest(items) as item
$$;

-- ---------------------------------------------------------------------------
-- 2. Per-person usage rows are only needed for today's limit and recent history: older than about 13 months they are
--    cleared every night (the everyone-together daily totals are tiny and kept).
-- ---------------------------------------------------------------------------
create function public.purge_old_usage(p_days integer default 400) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.usage_daily where day < current_date - p_days;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.purge_old_usage(integer) from public, anon, authenticated;
grant execute on function public.purge_old_usage(integer) to service_role;

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here. Schedule purge_old_usage elsewhere.';
    return;
  end if;
  begin
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.unschedule(jobname) from cron.job where jobname = 'hch-purge-usage';
    perform cron.schedule('hch-purge-usage', '53 3 * * *', 'select public.purge_old_usage(400)');
  exception when others then
    raise notice 'Could not schedule pg_cron jobs (%): %', sqlstate, sqlerrm;
  end;
end
$$;
