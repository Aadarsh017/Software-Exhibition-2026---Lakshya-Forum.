-- Schedules the clean-up jobs with pg_cron, if the extension can be enabled.
-- This must never fail a deploy: if pg_cron is unavailable on the plan, we say so and carry on,
-- and the same three functions can be called from any other scheduler (PLAN.md 7.2).
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here. Schedule purge_expired_cache, purge_stale_guests and purge_old_rule_events elsewhere.';
    return;
  end if;

  begin
    create extension if not exists pg_cron with schema pg_catalog;

    perform cron.unschedule(jobname) from cron.job
      where jobname in ('hch-purge-cache', 'hch-purge-stale-guests', 'hch-purge-rule-events');

    perform cron.schedule('hch-purge-cache', '17 * * * *', 'select public.purge_expired_cache()');
    perform cron.schedule('hch-purge-stale-guests', '23 3 * * *', 'select public.purge_stale_guests(30)');
    perform cron.schedule('hch-purge-rule-events', '41 3 * * *', 'select public.purge_old_rule_events(90)');
  exception when others then
    raise notice 'Could not schedule pg_cron jobs (%): %', sqlstate, sqlerrm;
  end;
end
$$;
